/**
 * Quita `COMERCIAL.GESTION_CONTRATO.VER` al rol COMERCIAL.
 *
 * Gestión Contrato es donde se reserva el cupo del salón ("Dejar listo"), y pasa a
 * ser trabajo de COMERCIAL_LIDER / COMERCIAL_JEFE. El comercial de a pie no lo ve.
 *
 * ⚠ Ese permiso gatea DOS cosas, no sólo el ítem del menú:
 *   1. el menú y la página `/dashboard/comercial/gestion-contrato` (+ sus endpoints)
 *   2. el botón amarillo "Contrato Para Aprobación" del detalle del contrato
 *      (`/api/postgres/people/[id]/listo-aprobacion`)
 * Quitarlo retira las dos. Si se quiere que COMERCIAL conserve el botón amarillo,
 * hay que darle permiso propio — hoy comparte éste.
 *
 * Idempotente. NO toca COMERCIAL_LIDER ni COMERCIAL_JEFE, que sí gestionan.
 *
 * Uso: node scripts/quitar-gestion-contrato-comercial.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const ROL = 'COMERCIAL';
const PERMISO = 'COMERCIAL.GESTION_CONTRATO.VER';
const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const row = (await pool.query(
    `SELECT "permisos" FROM "ROL_PERMISOS" WHERE "rol"=$1 LIMIT 1`, [ROL])).rows[0];
  if (!row) { console.error(`  No existe el rol ${ROL}.`); process.exit(1); }

  const antes = Array.isArray(row.permisos) ? row.permisos : [];
  const despues = antes.filter(p => String(p) !== PERMISO);

  console.log(`  ${ROL}: ${antes.length} permisos`);
  if (antes.length === despues.length) {
    console.log(`  Ya NO tiene "${PERMISO}": nada que hacer.\n`);
    await pool.end(); return;
  }
  console.log(`  Se quita: ${PERMISO}`);
  console.log(`  Quedaría con ${despues.length} permisos.`);

  // A quién afecta hoy
  const usuarios = (await pool.query(
    `SELECT "email","activo" FROM "USUARIOS_ROLES" WHERE "rol"=$1 ORDER BY "email"`, [ROL])).rows;
  console.log(`\n  Usuarios con rol ${ROL}: ${usuarios.length}`);
  if (usuarios.length) console.table(usuarios);

  // Quién SÍ conserva el permiso (los que gestionan)
  const conservan = (await pool.query(
    `SELECT "rol", (SELECT COUNT(*)::int FROM "USUARIOS_ROLES" u WHERE u."rol"=rp."rol") usuarios
       FROM "ROL_PERMISOS" rp
      WHERE rp."permisos" @> to_jsonb(ARRAY[$1::text]) AND rp."rol" <> $2
      ORDER BY "rol"`, [PERMISO, ROL])).rows;
  console.log('\n  Roles que CONSERVAN el permiso:');
  console.table(conservan);

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  await pool.query(
    `UPDATE "ROL_PERMISOS"
        SET "permisos" = $2::jsonb, "fechaActualizacion" = NOW(), "_updatedDate" = NOW()
      WHERE "rol" = $1`, [ROL, JSON.stringify(despues)]);

  const fin = (await pool.query(
    `SELECT "rol", jsonb_array_length("permisos") n,
            ("permisos" @> to_jsonb(ARRAY[$1::text])) AS tiene_gestion
       FROM "ROL_PERMISOS" WHERE "rol" ILIKE 'COMERCIAL%' ORDER BY "rol"`, [PERMISO])).rows;
  console.table(fin);
  console.log('\n  ⚠ El caché de permisos dura 5 min: quien tenga sesión abierta debe volver a entrar.\n');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
