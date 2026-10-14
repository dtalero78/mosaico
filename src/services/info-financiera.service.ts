import 'server-only'
import { query, queryOne, transaction } from '@/lib/postgres'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { ids } from '@/lib/id-generator'
import { calcularDerivados, validarInfoFinanciera, TIPOS_PLAN, type InfoFinanciera } from '@/lib/info-financiera'
import { isContratoPrueba } from '@/lib/contrato-prueba'
import { parseMoney } from '@/services/contract-creation.service'
import { syncFinancieroSaldo } from '@/services/pagos-titulares.service'
import { regenerarContratoEnDrive } from '@/services/contract-archive.service'

/**
 * Botón «InfoFinanciera» del detalle del contrato: vuelve a capturar el paso 6
 * de Crear Contrato y deja el contrato coherente en TODAS las tablas donde la
 * creación escribió esos datos:
 *
 *  - FINANCIEROS: total, inscripción, cuotas, valor cuota, fecha y medio de
 *    pago, vigencia y tipo de plan. El saldo lo recalcula `syncFinancieroSaldo`
 *    (es el saldo VIVO de cobranza: total − pagos verificados).
 *  - PEOPLE (titular): plan, módulo y vigencia; y si el contrato aún no está
 *    aprobado y cambió la vigencia, `finalContrato` de todo el contrato.
 *  - PAGOS_TITULARES cuota #0: los datos del plan y, si Recaudos todavía no la
 *    verificó, el monto de la inscripción.
 *
 * Después regenera el PDF en Drive (best-effort: si falla, los datos quedan
 * guardados y se informa). Un contrato de prueba (`PRB-`) no se archiva.
 *
 * Dos cambios se rechazan porque hay una herramienta propia para ellos:
 *  - la VIGENCIA o el MÓDULO de un contrato ya aprobado → Extender vigencia;
 *  - el monto de una inscripción que Recaudos ya verificó.
 */

const APROBADO = (aprob: string | null | undefined, estado: string | null | undefined) =>
  ['APROBADO', 'APROBADA', 'FINALIZADA'].includes(String(aprob || '').trim().toUpperCase()) ||
  String(estado || '').trim().toUpperCase() === 'FINALIZADA'

const fmt = (n: number) => Number(n || 0).toLocaleString('es-CL')

/** Lo guardado hoy, en la forma del formulario (para precargar el modal). */
export async function leerInfoFinanciera(titularId: string) {
  const t = await queryOne<any>(
    `SELECT "_id","contrato","plataforma","plan","modulo","vigencia","aprobacion","estado"
       FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [titularId]
  )
  if (!t) throw new NotFoundError('Titular', titularId)
  const fin = t.contrato ? await queryOne<any>(
    `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`, [t.contrato]
  ) : null
  const cuota0 = await queryOne<any>(
    `SELECT "validado" FROM "PAGOS_TITULARES" WHERE "idPeople" = $1 AND COALESCE("numCuota",0) = 0
      ORDER BY "_createdDate" ASC LIMIT 1`, [titularId]
  )
  const plan = String(fin?.plan || t.plan || '')
  const base = {
    totalPlan: parseMoney(fin?.totalPlan),
    pagoInscripcion: parseMoney(fin?.pagoInscripcion),
    numeroCuotas: parseInt(String(fin?.numeroCuotas ?? 0), 10) || 0,
  }
  const fechaPago = fin?.fechaPago ? String(fin.fechaPago).slice(0, 10) : ''
  const info: InfoFinanciera = {
    ...base,
    ...calcularDerivados(base),
    tipoPlan: (TIPOS_PLAN as readonly string[]).includes(plan) ? plan as any : '',
    fechaPago: /^\d{4}-\d{2}-\d{2}$/.test(fechaPago) ? fechaPago : '',
    vigencia: String(fin?.vigencia ?? t.vigencia ?? '').trim(),
    modulo: t.modulo === true,
    medioPago: String(fin?.medioPago || ''),
  }
  return {
    info,
    plataforma: t.plataforma || null,
    contrato: t.contrato || null,
    aprobado: APROBADO(t.aprobacion, t.estado),
    inscripcionVerificada: cuota0?.validado === true,
    tieneFinanciero: !!fin,
  }
}

export async function actualizarInfoFinanciera(
  titularId: string,
  input: Partial<InfoFinanciera>,
  actor: { email: string; nombre: string },
) {
  const t = await queryOne<any>(
    `SELECT "_id","contrato","numeroId","plataforma","plan","modulo","vigencia","aprobacion","estado"
       FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [titularId]
  )
  if (!t) throw new NotFoundError('Titular', titularId)
  if (!t.contrato) throw new ValidationError('El titular no tiene número de contrato.')

  // Se normaliza y se recalculan los derivados en el servidor: no se usa el
  // saldo ni la cuota que mande el navegador.
  const base = {
    totalPlan: parseMoney(input.totalPlan),
    pagoInscripcion: parseMoney(input.pagoInscripcion),
    numeroCuotas: parseInt(String(input.numeroCuotas ?? 0), 10) || 0,
  }
  const nuevo: InfoFinanciera = {
    ...base,
    ...calcularDerivados(base),
    tipoPlan: (TIPOS_PLAN as readonly string[]).includes(String(input.tipoPlan)) ? input.tipoPlan as any : '',
    fechaPago: String(input.fechaPago || '').slice(0, 10),
    vigencia: String(input.vigencia ?? '').trim(),
    modulo: input.modulo === true,
    medioPago: String(input.medioPago || '').trim(),
  }
  const error = validarInfoFinanciera(nuevo)
  if (error) throw new ValidationError(error)

  const actual = await leerInfoFinanciera(titularId)
  const prev = actual.info

  if (actual.aprobado && (prev.vigencia !== nuevo.vigencia || prev.modulo !== nuevo.modulo)) {
    throw new ValidationError(
      'El contrato ya está aprobado: la vigencia y el Módulo no se cambian aquí. Usa «Extender vigencia» en la ficha del alumno.'
    )
  }
  if (actual.inscripcionVerificada && prev.pagoInscripcion !== nuevo.pagoInscripcion) {
    throw new ValidationError(
      `Recaudos ya verificó la inscripción por $${fmt(prev.pagoInscripcion)}: ese monto no se puede cambiar desde aquí.`
    )
  }

  // Resumen de cambios para la bitácora y la respuesta.
  const cambios: string[] = []
  // Un 0 es un valor (contado = 0 cuotas): sólo lo vacío se muestra como «—».
  const ver = (v: any, money: boolean) => (money ? '$' + fmt(v) : (v === '' || v == null ? '—' : String(v)))
  const comp = (label: string, a: any, b: any, money = false) => {
    if (String(a ?? '') !== String(b ?? '')) cambios.push(`${label}: ${ver(a, money)} → ${ver(b, money)}`)
  }
  comp('Total del plan', prev.totalPlan, nuevo.totalPlan, true)
  comp('Inscripción', prev.pagoInscripcion, nuevo.pagoInscripcion, true)
  comp('Cuotas', prev.numeroCuotas, nuevo.numeroCuotas)
  comp('Valor cuota', prev.valorCuota, nuevo.valorCuota, true)
  comp('Tipo de plan', prev.tipoPlan, nuevo.tipoPlan)
  comp('Fecha de pago', prev.fechaPago, nuevo.fechaPago)
  comp('Vigencia', prev.vigencia, nuevo.vigencia)
  comp('Módulo', prev.modulo ? 'Sí' : 'No', nuevo.modulo ? 'Sí' : 'No')
  comp('Medio de pago', prev.medioPago, nuevo.medioPago)

  const cambioVigencia = prev.vigencia !== nuevo.vigencia
  const plan = nuevo.tipoPlan || null

  await transaction(async (client) => {
    // FINANCIEROS — todas las filas del contrato (hay contratos con duplicadas;
    // syncFinancieroSaldo ya las mantiene alineadas).
    const upd = await client.query(
      `UPDATE "FINANCIEROS"
          SET "totalPlan" = $2, "pagoInscripcion" = $3, "numeroCuotas" = $4, "valorCuota" = $5,
              "fechaPago" = $6::date, "medioPago" = $7, "vigencia" = $8, "plan" = $9, "_updatedDate" = NOW()
        WHERE "contrato" = $1`,
      [t.contrato, nuevo.totalPlan, nuevo.pagoInscripcion, nuevo.numeroCuotas, nuevo.valorCuota,
       nuevo.fechaPago, nuevo.medioPago, nuevo.vigencia, plan]
    )
    if (!upd.rowCount) {
      await client.query(
        `INSERT INTO "FINANCIEROS" ("_id","contrato","totalPlan","numeroCuotas","valorCuota",
           "pagoInscripcion","saldo","fechaPago","medioPago","vigencia","plan","origen","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,'POSTGRES',NOW(),NOW())`,
        [ids.financial(), t.contrato, nuevo.totalPlan, nuevo.numeroCuotas, nuevo.valorCuota,
         nuevo.pagoInscripcion, nuevo.saldo, nuevo.fechaPago, nuevo.medioPago, nuevo.vigencia, plan]
      )
    }

    // Titular: plan, módulo y vigencia.
    await client.query(
      `UPDATE "PEOPLE" SET "plan" = $2, "modulo" = $3, "vigencia" = $4, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [titularId, plan, nuevo.modulo, nuevo.vigencia]
    )
    // Contrato aún sin aprobar y nueva vigencia: el fin del contrato se recalcula
    // desde la fecha de firma para TODO el contrato (misma regla que al crearlo).
    if (cambioVigencia) {
      await client.query(
        `UPDATE "PEOPLE"
            SET "vigencia" = $2,
                "finalContrato" = (COALESCE("fechaContrato", "_createdDate")::date + make_interval(months => $3::int))::date,
                "_updatedDate" = NOW()
          WHERE "contrato" = $1`,
        [t.contrato, nuevo.vigencia, parseInt(nuevo.vigencia, 10)]
      )
    }

    // Cuota #0: datos del plan; el monto sólo si Recaudos no la verificó.
    await client.query(
      `UPDATE "PAGOS_TITULARES"
          SET "vlrTotalProg" = $2, "cuotasTotal" = $3, "valorCuota" = $4, "plan" = $5,
              "medioPago" = $6, "fechaVencimiento" = $7::date, "saldo" = $8,
              "valorPagado" = CASE WHEN COALESCE("validado", false) THEN "valorPagado" ELSE $9 END,
              "inscripcion" = CASE WHEN COALESCE("validado", false) THEN "inscripcion" ELSE $9 END,
              "_updatedDate" = NOW()
        WHERE "idPeople" = $1 AND COALESCE("numCuota", 0) = 0`,
      [titularId, nuevo.totalPlan, nuevo.numeroCuotas, nuevo.valorCuota, plan,
       nuevo.medioPago, nuevo.fechaPago, nuevo.saldo, nuevo.pagoInscripcion]
    )

    // Bitácora en los comentarios del titular.
    if (cambios.length) {
      const comentario = {
        id: ids.comment(),
        texto: `[Info Financiera] ${cambios.join(' · ')}`,
        areaRemitente: 'Comercial', areaDestinatario: 'General',
        usuario: actor.nombre || actor.email || 'Sistema',
        fecha: new Date().toISOString(),
      }
      await client.query(
        `UPDATE "PEOPLE" SET "comentarios" = array_append(COALESCE("comentarios"::text[], ARRAY[]::text[]), $2)::text, "_updatedDate" = NOW() WHERE "_id" = $1`,
        [titularId, JSON.stringify(comentario)]
      )
    }
  })

  // Saldo vivo (total − pagos verificados) y cuotas pagadas.
  await syncFinancieroSaldo(titularId)

  // PDF en Drive — best-effort.
  let pdf: { ok: boolean; archivo?: string; omitido?: string; error?: string }
  if (isContratoPrueba(t.contrato)) {
    pdf = { ok: false, omitido: 'Es un contrato de prueba: no se archiva en Drive.' }
  } else {
    try {
      const r = await regenerarContratoEnDrive(titularId)
      pdf = { ok: true, archivo: r.archivo }
    } catch (e: any) {
      pdf = { ok: false, error: e?.message || 'No se pudo regenerar el PDF.' }
    }
  }

  return { cambios, pdf }
}
