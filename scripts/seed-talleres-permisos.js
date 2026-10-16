/**
 * Siembra los permisos de Servicio › Talleres (VER, ENVIAR, EXPORTAR) a los
 * roles de SERVICIO (decisión del usuario): SERVICIO, SERVICIO_CASOS y
 * SERVICIO_NIVELACIONES. No se usa "quien ya ve Casos de Atención" como
 * criterio porque arrastraría a Recaudos y a los roles académicos; esos se
 * marcan a mano en /admin/permissions si hace falta. SUPER_ADMIN y ADMIN pasan
 * por bypass. Idempotente: no duplica permisos ya presentes.
 *
 * Uso: node scripts/seed-talleres-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const NUEVOS = ['SERVICIO.TALLERES.VER', 'SERVICIO.TALLERES.ENVIAR', 'SERVICIO.TALLERES.EXPORTAR'];
const ROLES = ['SERVICIO', 'SERVICIO_CASOS', 'SERVICIO_NIVELACIONES'];

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "rol" = ANY($1::text[]) ORDER BY "rol"`, [ROLES]
  );
  const plan = [];
  for (const r of rows) {
    const permisos = Array.isArray(r.permisos) ? r.permisos : [];
    const faltan = NUEVOS.filter(p => !permisos.includes(p));
    if (faltan.length) plan.push({ rol: r.rol, faltan, permisos });
  }
  if (!plan.length) { console.log('✓ Nada que hacer: todos los roles ya los tienen.'); await pool.end(); return; }
  for (const p of plan) console.log(`${p.rol}: + ${p.faltan.join(', ')}`);
  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }
  for (const p of plan) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $2::jsonb, "_updatedDate" = NOW() WHERE "rol" = $1`,
      [p.rol, JSON.stringify([...p.permisos, ...p.faltan])]
    );
  }
  console.log(`\n✅ ${plan.length} rol(es) actualizados.`);
  await pool.end();
})().catch(async (e) => { console.error('❌', e.message); await pool.end(); process.exit(1); });
