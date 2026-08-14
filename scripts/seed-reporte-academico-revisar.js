/**
 * Otorga ACADEMICO.REPORTE_ACADEMICO.REVISAR a COORDINADOR_ACADEMICO.
 *
 * Es el permiso que deja modificar el informe semanal que el Guía ya cerró y darle
 * el cierre DEFINITIVO. ADMIN y SUPER_ADMIN pasan por bypass, así que no se les
 * añade. Idempotente: si el rol ya lo tiene, no hace nada.
 *
 * Uso: node scripts/seed-reporte-academico-revisar.js [--apply] [--rol=OTRO_ROL]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const PERMISO = 'ACADEMICO.REPORTE_ACADEMICO.REVISAR';
const APPLY = process.argv.includes('--apply');
const rolArg = process.argv.find(a => a.startsWith('--rol='));
const ROL = rolArg ? rolArg.slice(6) : 'COORDINADOR_ACADEMICO';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(`SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "rol" = $1`, [ROL]);
  if (!rows.length) {
    console.error(`❌ El rol ${ROL} no existe en ROL_PERMISOS.`);
    await pool.end();
    process.exit(1);
  }
  const permisos = Array.isArray(rows[0].permisos) ? rows[0].permisos : JSON.parse(rows[0].permisos || '[]');
  if (permisos.includes(PERMISO)) {
    console.log(`✓ ${ROL} ya tiene ${PERMISO} (${permisos.length} permisos) — nada que hacer.`);
    await pool.end();
    return;
  }
  console.log(`${ROL} tiene ${permisos.length} permisos y NO incluye ${PERMISO}.`);
  if (!APPLY) {
    console.log('\n(dry-run) Se agregaría el permiso. Reejecuta con --apply.');
    await pool.end();
    return;
  }
  const nuevos = [...permisos, PERMISO];
  await pool.query(
    `UPDATE "ROL_PERMISOS"
        SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW()
      WHERE "rol" = $2`,
    [JSON.stringify(nuevos), ROL]
  );
  const { rows: post } = await pool.query(`SELECT "permisos" FROM "ROL_PERMISOS" WHERE "rol" = $1`, [ROL]);
  const fin = Array.isArray(post[0].permisos) ? post[0].permisos : JSON.parse(post[0].permisos || '[]');
  console.log(`✅ ${ROL} ahora tiene ${fin.length} permisos, incluido ${PERMISO}.`);
  console.log('   (la caché de permisos es de 5 min: el cambio se ve en ese plazo o al reingresar)');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
