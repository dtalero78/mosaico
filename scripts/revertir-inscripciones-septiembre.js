/**
 * Devuelve a PENDIENTE las inscripciones (cuota #0) de SEPTIEMBRE 2026, para
 * que entren a Centro de Validación › Verificación Inscripción.
 *
 * Por qué: hasta sep-2026 la cuota #0 nacía con validado=true escrita en duro
 * al crear el contrato, así que esa pestaña estaba siempre vacía y nadie
 * verificaba que el dinero de la inscripción hubiera entrado. El código ya
 * quedó corregido (nace sin verificar); esto alinea las que se crearon en el
 * mes en curso. Las anteriores a septiembre se dejan como están, a propósito:
 * ya cumplieron su ciclo y sólo les falta la factura.
 *
 * ⚠ EFECTO EN EL SALDO: syncFinancieroSaldo sólo suma pagos validados, así que
 * al revertir la inscripción el "Saldo a la Fecha" de ese contrato SUBE al
 * valor del plan completo, y vuelve a bajar cuando recaudos la verifique. Es
 * la misma regla que ya rige para las cuotas normales. El script recalcula el
 * saldo de cada titular afectado para que la ficha quede coherente en el acto.
 *
 * NO toca una inscripción que ya tenga número de factura (revertir algo ya
 * facturado dejaría la factura colgando de un pago sin verificar).
 *
 * Idempotente: sólo mira las que están en validado=true, así que re-correrlo
 * no hace nada. Transaccional: o se aplican todas, o ninguna.
 *
 * Uso:
 *   node scripts/revertir-inscripciones-septiembre.js            # ensayo
 *   node scripts/revertir-inscripciones-septiembre.js --apply    # aplica
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const MES = '2026-09'

const cs = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/i, '$1sslmode=no-verify')
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } })

const toNum = (v) => {
  if (v == null) return 0
  const s = String(v).replace(/[^0-9.-]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

async function main() {
  const { rows: objetivo } = await pool.query(
    `SELECT pt."_id", pt."idPeople", pt."fechaPago"::text AS "fechaPago",
            pt."valorPagado", pt."validadoPor",
            p."contrato", p."primerNombre", p."primerApellido"
       FROM "PAGOS_TITULARES" pt
       JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
      WHERE COALESCE(pt."numCuota", 0) = 0
        AND pt."validado" = true
        AND COALESCE(pt."numeroFactura", '') = ''
        AND to_char(pt."fechaPago", 'YYYY-MM') = $1
      ORDER BY pt."fechaPago", p."primerApellido"`,
    [MES]
  )

  const { rows: [omitidas] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "PAGOS_TITULARES"
      WHERE COALESCE("numCuota", 0) = 0 AND "validado" = true
        AND COALESCE("numeroFactura", '') <> ''
        AND to_char("fechaPago", 'YYYY-MM') = $1`,
    [MES]
  )

  console.log(`Inscripciones de ${MES} a revertir: ${objetivo.length}`)
  if (omitidas.n > 0) console.log(`Omitidas por tener factura ya registrada: ${omitidas.n}`)
  const suma = objetivo.reduce((a, r) => a + toNum(r.valorPagado), 0)
  console.log(`Valor total de esas inscripciones: ${suma.toLocaleString('es-CL')}`)
  const titulares = [...new Set(objetivo.map(r => r.idPeople))]
  console.log(`Titulares cuyo saldo se recalcula: ${titulares.length}`)

  if (!APPLY) {
    console.log('\nENSAYO — no se escribió nada. Corre con --apply para aplicar.')
    console.table(objetivo.slice(0, 10).map(r => ({
      contrato: r.contrato,
      titular: `${r.primerNombre || ''} ${r.primerApellido || ''}`.trim(),
      fechaPago: r.fechaPago,
      valor: toNum(r.valorPagado),
      validadaPor: r.validadoPor,
    })))
    if (objetivo.length > 10) console.log(`… y ${objetivo.length - 10} más.`)
    await pool.end()
    return
  }

  if (objetivo.length === 0) {
    console.log('Nada que hacer.')
    await pool.end()
    return
  }

  const client = await pool.connect()
  let saldosActualizados = 0
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE "PAGOS_TITULARES"
          SET "validado" = false, "fechaValidacion" = NULL, "validadoPor" = NULL,
              "_updatedDate" = NOW()
        WHERE "_id" = ANY($1::text[])`,
      [objetivo.map(r => r._id)]
    )

    // Recalcular el saldo de cada titular con la MISMA regla de
    // syncFinancieroSaldo: totalPlan menos lo que esté validado.
    for (const idPeople of titulares) {
      const { rows: [per] } = await client.query(
        `SELECT "contrato" FROM "PEOPLE" WHERE "_id" = $1`, [idPeople]
      )
      if (!per || !per.contrato) continue

      const { rows: [sum] } = await client.query(
        `SELECT COALESCE(SUM(COALESCE("valorPagado",0) + COALESCE("descuento",0)), 0)::text AS total,
                COALESCE(SUM(CASE WHEN COALESCE("numCuota",0) > 0 THEN 1 ELSE 0 END), 0)::text AS cuotas
           FROM "PAGOS_TITULARES"
          WHERE "idPeople" = $1 AND "validado" = true`,
        [idPeople]
      )
      const { rows: [fin] } = await client.query(
        `SELECT "totalPlan" FROM "FINANCIEROS" WHERE "contrato" = $1 LIMIT 1`,
        [per.contrato]
      )
      if (!fin) continue

      const nuevoSaldo = Math.max(0, toNum(fin.totalPlan) - toNum(sum.total))
      await client.query(
        `UPDATE "FINANCIEROS"
            SET "saldo" = $1, "cuotasPagadas" = $2, "_updatedDate" = NOW()
          WHERE "contrato" = $3`,
        [String(Math.round(nuevoSaldo)), parseInt(sum.cuotas, 10) || 0, per.contrato]
      )
      saldosActualizados++
    }

    await client.query('COMMIT')
    console.log(`\nAPLICADO: ${objetivo.length} inscripciones a pendiente, ${saldosActualizados} saldos recalculados.`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('ROLLBACK — no se escribió nada:', e.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
