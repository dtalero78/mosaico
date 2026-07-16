/**
 * Retira "Reiniciar Nivel" (Inicializar Nivel) de la base.
 *
 * Utilidad: la feature se eliminó del código (operaba el motor de Steps de LGS que
 * MOSAICO no usa, y su endpoint nunca validó permisos server-side). Esto limpia lo
 * que quedó en BD:
 *   1. Quita 'STUDENT.ACADEMIA.INICIALIZAR_NIVEL' de ROL_PERMISOS.
 *   2. Elimina las columnas de auditoría ACADEMICA.inicianivel / .checkinicianivel.
 *
 * Las columnas se dropean sólo si están VACÍAS (0 filas con datos) — la feature
 * nunca se ejecutó en mosaico-db. Si algún registro tuviera datos, el script
 * ABORTA el drop para no destruir historial.
 *
 * Idempotente. Uso:
 *   node scripts/drop-inicializar-nivel.js           (dry-run)
 *   node scripts/drop-inicializar-nivel.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const PERMISO = 'STUDENT.ACADEMIA.INICIALIZAR_NIVEL';

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    // 1. Permiso en ROL_PERMISOS
    const roles = await pool.query(
      `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "permisos"::jsonb ? $1 ORDER BY "rol"`,
      [PERMISO]
    );
    console.log(`Roles con ${PERMISO}: ${roles.rows.map(r => r.rol).join(', ') || '(ninguno)'}`);
    for (const r of roles.rows) {
      const actuales = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
      const nuevos = actuales.filter((p) => p !== PERMISO);
      console.log(`  ${r.rol}: ${APPLY ? 'quitando' : 'quitaría'} el permiso (${actuales.length} → ${nuevos.length})`);
      if (APPLY) {
        await pool.query(
          `UPDATE "ROL_PERMISOS" SET "permisos" = ($2)::jsonb, "fechaActualizacion" = NOW(), "_updatedDate" = NOW() WHERE "rol" = $1`,
          [r.rol, JSON.stringify(nuevos)]
        );
      }
    }

    // 2. Columnas de auditoría — sólo si están vacías
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ACADEMICA' AND column_name IN ('inicianivel','checkinicianivel')`
    );
    if (cols.rowCount === 0) {
      console.log('\nColumnas inicianivel/checkinicianivel: ya no existen.');
    } else {
      const d = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE "checkinicianivel" IS NOT NULL)::int a,
                COUNT(*) FILTER (WHERE "inicianivel" IS NOT NULL)::int b FROM "ACADEMICA"`
      );
      const conDatos = d.rows[0].a + d.rows[0].b;
      console.log(`\nColumnas de auditoría: ${cols.rows.map(c => c.column_name).join(', ')} | filas con datos: ${conDatos}`);
      if (conDatos > 0) {
        console.log('⚠ ABORTADO el drop: hay historial. Revisar antes de eliminar.');
      } else if (APPLY) {
        await pool.query(`ALTER TABLE "ACADEMICA" DROP COLUMN IF EXISTS "inicianivel"`);
        await pool.query(`ALTER TABLE "ACADEMICA" DROP COLUMN IF EXISTS "checkinicianivel"`);
        console.log('✅ Columnas eliminadas (estaban vacías).');
      } else {
        console.log('  Se eliminarían (están vacías).');
      }
    }

    if (!APPLY) console.log('\n--- DRY RUN (sin --apply no se escribe nada) ---');
    else console.log('\n✅ Listo. El caché de permisos tarda hasta 5 min en refrescar.');
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
