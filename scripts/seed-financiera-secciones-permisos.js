/**
 * Seed de los permisos de sección de la pestaña Financiera de /person:
 *   PERSON.FINANCIERA.RESUMEN_VER      → sección "Resumen Financiero del Titular"
 *   PERSON.FINANCIERA.INFO_PAGOS_VER   → sección "Información de Pagos"
 * ("Pagos del Titular" ya tenía PERSON.FINANCIERA.PAGOS_VER.)
 *
 * Se otorgan a los roles que YA tienen algún permiso PERSON.FINANCIERA.* para
 * preservar su acceso actual (las secciones antes se mostraban sin permiso).
 * Idempotente: no duplica si el rol ya los tiene. SUPER_ADMIN/ADMIN bypassean
 * igual, pero se incluyen si aparecen.
 *
 * Uso: node scripts/seed-financiera-secciones-permisos.js          # dry-run
 *      node scripts/seed-financiera-secciones-permisos.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const NUEVOS = ['PERSON.FINANCIERA.RESUMEN_VER', 'PERSON.FINANCIERA.INFO_PAGOS_VER'];
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const roles = (await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "permisos"::text LIKE '%PERSON.FINANCIERA%' ORDER BY "rol"`)).rows;

  for (const r of roles) {
    const actuales = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
    const faltan = NUEVOS.filter(p => !actuales.includes(p));
    if (!faltan.length) { console.log(`= ${r.rol}: ya los tiene`); continue; }
    console.log(`${APPLY ? '✓' : '(dry)'} ${r.rol}: +${faltan.join(', +')}`);
    if (APPLY) {
      await pool.query(
        `UPDATE "ROL_PERMISOS" SET "permisos" = $2::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "rol" = $1`,
        [r.rol, JSON.stringify([...actuales, ...faltan])]);
    }
  }
  await pool.end();
  if (!APPLY) console.log('\n(dry-run — nada escrito. Agrega --apply.)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
