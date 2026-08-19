/**
 * Siembra `COMERCIAL.CONTRATO.LISTO_APROBACION` — el permiso propio del botón
 * amarillo "Contrato Para Aprobación" del detalle del contrato.
 *
 * Antes ese botón compartía permiso con la PÁGINA Gestión Contrato, así que
 * ocultarle esa pantalla a un rol le quitaba también el botón. Son cosas
 * distintas: el botón sólo marca el contrato para que salga en el Centro de
 * Aprobación; Gestión Contrato además RESERVA el cupo del salón.
 *
 * Se otorga a los roles comerciales, **COMERCIAL incluido**: ése es el rol con el
 * que entran los asesores desde el CRM (`/api/auth/crm-bridge` asigna
 * `role: 'COMERCIAL'`), y son justamente quienes usan el botón. No aparecen en
 * `USUARIOS_ROLES` porque llegan por SSO — contarlos ahí da 0 y engaña.
 *
 * Idempotente. SUPER_ADMIN y ADMIN no lo necesitan (bypassean todo permiso).
 *
 * Uso: node scripts/seed-contrato-listo-aprobacion.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const PERMISO = 'COMERCIAL.CONTRATO.LISTO_APROBACION';
const ROLES = ['COMERCIAL', 'COMERCIAL_LIDER', 'COMERCIAL_JEFE'];
const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const filas = (await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "rol" = ANY($1)`, [ROLES])).rows;

  const pendientes = [];
  for (const r of filas) {
    const tiene = (Array.isArray(r.permisos) ? r.permisos : []).includes(PERMISO);
    console.log(`  ${r.rol.padEnd(18)} ${tiene ? 'ya lo tiene' : '→ se le agrega'}`);
    if (!tiene) pendientes.push(r.rol);
  }
  const faltantes = ROLES.filter(x => !filas.some(f => f.rol === x));
  if (faltantes.length) console.log(`  ⚠ roles inexistentes (se omiten): ${faltantes.join(', ')}`);

  if (!pendientes.length) { console.log('\n  Nada que hacer.\n'); await pool.end(); return; }
  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  await pool.query(
    `UPDATE "ROL_PERMISOS"
        SET "permisos" = "permisos" || to_jsonb(ARRAY[$1::text]),
            "fechaActualizacion" = NOW(), "_updatedDate" = NOW()
      WHERE "rol" = ANY($2)`, [PERMISO, pendientes]);

  console.table((await pool.query(
    `SELECT "rol", jsonb_array_length("permisos") permisos,
            ("permisos" @> to_jsonb(ARRAY[$1::text])) AS "puede_marcar_listo",
            ("permisos" @> '["COMERCIAL.GESTION_CONTRATO.VER"]'::jsonb) AS "ve_gestion_contrato"
       FROM "ROL_PERMISOS" WHERE "rol" ILIKE 'COMERCIAL%' ORDER BY "rol"`, [PERMISO])).rows);
  console.log('\n  ⚠ El caché de permisos dura 5 min: quien tenga sesión abierta debe volver a entrar.\n');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
