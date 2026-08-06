/**
 * MOSAICO — siembra los 4 permisos nuevos de Recaudos (Aprobaciones/Bancos/masivos)
 * a los roles que ya tienen el permiso hermano. Idempotente.
 *   - RECAUDOS.GESTION.VER    → + RECAUDOS.BANCOS.VER, RECAUDOS.APROBACION_MASIVA
 *   - RECAUDOS.ASIGNACION.VER → + RECAUDOS.APROBACIONES.VER, RECAUDOS.APROBACIONES.ASIGNAR
 * SUPER_ADMIN/ADMIN reciben todos (bypassan igual). El admin refina el resto en /admin/permissions.
 * Uso: node scripts/seed-recaudos-aprobaciones-permisos.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const ALWAYS = ['SUPER_ADMIN', 'ADMIN'];
// [permiso nuevo, permiso hermano que lo habilita]
const REGLAS = [
  ['RECAUDOS.BANCOS.VER',           'RECAUDOS.GESTION.VER'],
  ['RECAUDOS.APROBACION_MASIVA',    'RECAUDOS.GESTION.VER'],
  ['RECAUDOS.APROBACIONES.VER',     'RECAUDOS.ASIGNACION.VER'],
  ['RECAUDOS.APROBACIONES.ASIGNAR', 'RECAUDOS.ASIGNACION.VER'],
];
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(`SELECT rol, permisos FROM "ROL_PERMISOS"`);
  let n = 0;
  for (const r of rows) {
    const perms = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
    const set = new Set(perms);
    let changed = false;
    for (const [nuevo, base] of REGLAS) {
      if ((set.has(base) || ALWAYS.includes(r.rol)) && !set.has(nuevo)) {
        set.add(nuevo); changed = true;
        console.log(`  ${APPLY ? '✓' : '·'} ${r.rol} +${nuevo}`);
      }
    }
    if (changed) {
      n++;
      if (APPLY) await pool.query(`UPDATE "ROL_PERMISOS" SET permisos=$2::jsonb,"fechaActualizacion"=NOW() WHERE rol=$1`, [r.rol, JSON.stringify([...set])]);
    }
  }
  console.log(APPLY ? `✅ ${n} rol(es) actualizados.` : `(dry-run) ${n} rol(es) cambiarían. --apply para escribir.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
