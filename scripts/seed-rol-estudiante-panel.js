/**
 * Siembra/actualiza el rol ESTUDIANTE en ROL_PERMISOS con el permiso del panel
 * del alumno STUDENT.PANEL.VER_VIDEO (botón "Ver video"). Idempotente.
 *
 * El panel del estudiante ahora gatea el botón "Ver video" con este permiso vía
 * usePermissions. Con el permiso presente el botón se muestra; el admin puede
 * quitarlo en /admin/permissions para ocultarlo a todos los estudiantes.
 *
 * Uso: node scripts/seed-rol-estudiante-panel.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
const PERM = 'STUDENT.PANEL.VER_VIDEO';

(async () => {
  const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ROL_PERMISOS'`)).rows.map(r => r.column_name);
  const ex = await pool.query(`SELECT "_id","permisos" FROM "ROL_PERMISOS" WHERE UPPER("rol")='ESTUDIANTE' LIMIT 1`);
  if (ex.rows.length) {
    const perms = Array.isArray(ex.rows[0].permisos) ? ex.rows[0].permisos : [];
    if (perms.includes(PERM)) { console.log('= ESTUDIANTE ya tiene', PERM, '(idempotente)'); }
    else {
      perms.push(PERM);
      await pool.query(
        `UPDATE "ROL_PERMISOS" SET "permisos"=$2::jsonb${cols.includes('fechaActualizacion') ? `, "fechaActualizacion"=NOW()` : ''}${cols.includes('_updatedDate') ? `, "_updatedDate"=NOW()` : ''} WHERE "_id"=$1`,
        [ex.rows[0]._id, JSON.stringify(perms)]);
      console.log('✓ agregado', PERM, 'a ESTUDIANTE →', JSON.stringify(perms));
    }
  } else {
    const c = ['"_id"', '"rol"', '"permisos"'], v = ['$1', '$2', '$3::jsonb'], p = [randomUUID(), 'ESTUDIANTE', JSON.stringify([PERM])];
    let i = 4;
    if (cols.includes('descripcion')) { c.push('"descripcion"'); v.push(`$${i++}`); p.push('Estudiante (panel del alumno)'); }
    if (cols.includes('activo')) { c.push('"activo"'); v.push('true'); }
    ['fechaCreacion', 'fechaActualizacion', '_createdDate', '_updatedDate'].forEach(cc => { if (cols.includes(cc)) { c.push(`"${cc}"`); v.push('NOW()'); } });
    await pool.query(`INSERT INTO "ROL_PERMISOS" (${c.join(',')}) VALUES (${v.join(',')})`, p);
    console.log('✓ creado rol ESTUDIANTE con', PERM);
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
