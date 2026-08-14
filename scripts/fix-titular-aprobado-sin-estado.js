/**
 * Repara los titulares que quedaron **Aprobados pero con `estado` en NULL**.
 *
 * Causa: al aprobar un BENEFICIARIO desde su ficha, el endpoint auto-aprueba al
 * titular si seguía pendiente — pero ese UPDATE sólo escribía `aprobacion`, no
 * `estado` ni `estadoInactivo`. El titular quedaba "Aprobado" con el badge
 * "Estado: Null". La ruta normal (`approveOnePerson`, Centro de Aprobaciones) sí
 * escribe los tres campos; por eso el beneficiario salía ACTIVA y el titular no.
 *
 * El código ya está corregido; esto arregla a los que quedaron de antes.
 * Sólo toca titulares con `aprobacion = 'Aprobado'` y `estado` vacío: les pone
 * `estado='ACTIVA'` (y `estadoInactivo=false` si estuviera en true), que es
 * exactamente lo que la aprobación debía haber dejado.
 *
 * Idempotente. Uso: node scripts/fix-titular-aprobado-sin-estado.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT t."_id", t."contrato",
            TRIM(CONCAT_WS(' ', t."primerNombre", t."primerApellido")) AS titular,
            COALESCE(t."estadoInactivo", false) AS inactivo,
            (SELECT COUNT(*)::int FROM "PEOPLE" b
              WHERE b."contrato" = t."contrato" AND b."tipoUsuario" = 'BENEFICIARIO') AS beneficiarios
       FROM "PEOPLE" t
      WHERE t."tipoUsuario" = 'TITULAR'
        AND COALESCE(t."contrato", '') NOT LIKE 'PRB-%'
        AND LOWER(TRIM(COALESCE(t."aprobacion", ''))) = 'aprobado'
        AND COALESCE(NULLIF(TRIM(t."estado"), ''), '') = ''
      ORDER BY titular`
  );

  if (!rows.length) {
    console.log('✅ No hay titulares aprobados sin estado.');
    await pool.end();
    return;
  }

  console.log(`\n${rows.length} titular(es) Aprobados con estado NULL:\n`);
  console.table(rows.map(r => ({
    titular: r.titular, contrato: r.contrato,
    beneficiarios: r.beneficiarios, inactivo: r.inactivo ? 'sí' : '',
    quedara: 'ACTIVA',
  })));

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  const r = await pool.query(
    `UPDATE "PEOPLE"
        SET "estado" = 'ACTIVA', "estadoInactivo" = false, "_updatedDate" = NOW()
      WHERE "_id" = ANY($1)`,
    [rows.map(x => x._id)]
  );
  const { rows: [chk] } = await pool.query(
    `SELECT COUNT(*)::int n FROM "PEOPLE"
      WHERE "tipoUsuario" = 'TITULAR' AND COALESCE("contrato",'') NOT LIKE 'PRB-%'
        AND LOWER(TRIM(COALESCE("aprobacion",''))) = 'aprobado'
        AND COALESCE(NULLIF(TRIM("estado"), ''), '') = ''`
  );
  console.log(`\n✅ ${r.rowCount} titular(es) actualizados. Quedan sin estado: ${chk.n}`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
