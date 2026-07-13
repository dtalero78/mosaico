/**
 * MOSAICO — gatear TODOS los ítems de la pestaña Académica de /student.
 *
 * Preserva el acceso actual sembrando (solo si faltan) los permisos NUEVOS a los
 * roles que ya son "académicos":
 *   - VER_ASISTENCIA, NIVELACION_HISTORIAL, AGENDAR_CLASE → a los roles que ya
 *     tienen STUDENT.ACADEMIA.COMO_VOY (ya operan en la pestaña Académica).
 *   - CAMBIO_ACADEMICO → a los roles que ya tienen STUDENT.ACADEMIA.ASIGNAR_STEP
 *     (operaciones académicas pesadas).
 * SUPER_ADMIN/ADMIN bypassean por código; igual se les siembra por completitud.
 *
 * Uso: node scripts/seed-student-academia-permisos.js            (dry-run)
 *      node scripts/seed-student-academia-permisos.js --apply
 * Idempotente: solo agrega el permiso si el rol no lo tiene.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const VIEW_PERMS = ['STUDENT.ACADEMIA.VER_ASISTENCIA', 'STUDENT.ACADEMIA.NIVELACION_HISTORIAL', 'STUDENT.ACADEMIA.AGENDAR_CLASE'];
const CAMBIO = 'STUDENT.ACADEMIA.CAMBIO_ACADEMICO';
const ALWAYS = ['SUPER_ADMIN', 'ADMIN'];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const { rows } = await pool.query(`SELECT rol, permisos FROM "ROL_PERMISOS"`);
    let cambiados = 0;
    for (const r of rows) {
      const perms = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
      const set = new Set(perms);
      const before = set.size;
      const esAcademico = set.has('STUDENT.ACADEMIA.COMO_VOY') || ALWAYS.includes(r.rol);
      const esPesado = set.has('STUDENT.ACADEMIA.ASIGNAR_STEP') || ALWAYS.includes(r.rol);
      if (esAcademico) VIEW_PERMS.forEach(p => set.add(p));
      if (esPesado) set.add(CAMBIO);
      if (set.size !== before) {
        const nuevos = [...set].filter(p => !perms.includes(p));
        console.log(`  ${APPLY ? '✓' : '·'} ${r.rol}: +${nuevos.join(', ')}`);
        if (APPLY) {
          await pool.query(`UPDATE "ROL_PERMISOS" SET permisos = $2::jsonb, "fechaActualizacion" = NOW() WHERE rol = $1`, [r.rol, JSON.stringify([...set])]);
        }
        cambiados++;
      }
    }
    console.log(APPLY ? `✅ ${cambiados} rol(es) actualizados.` : `(dry-run) ${cambiados} rol(es) cambiarían. Corre con --apply.`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
