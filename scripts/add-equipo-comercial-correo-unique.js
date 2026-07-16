/**
 * Índice ÚNICO en EQUIPO_COMERCIAL por correo (case-insensitive).
 *
 * Utilidad: el correo identifica a la persona del equipo comercial. Ahora hay DOS
 * flujos que escriben la tabla:
 *   1. /admin/roles/create  → alta con login (USUARIOS_ROLES + clave).
 *   2. Crear/Migrar Contrato → alta de CATÁLOGO (sólo nombre/correo/plataforma,
 *      sin login), para que el correo del asesor quede registrado al vender.
 * Sin índice único, el mismo asesor podría acabar duplicado (una fila por flujo) y
 * `getAsesorInfo` resolvería un correo u otro según el orden de inserción.
 *
 * El índice existente `idx_equipo_comercial_correo` NO es único; se reemplaza.
 * Aborta si hay correos duplicados (habría que consolidarlos a mano primero).
 *
 * Idempotente. Uso:
 *   node scripts/add-equipo-comercial-correo-unique.js           (dry-run)
 *   node scripts/add-equipo-comercial-correo-unique.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const dups = await pool.query(
      `SELECT LOWER(TRIM("correo")) AS correo, COUNT(*)::int n
         FROM "EQUIPO_COMERCIAL" GROUP BY 1 HAVING COUNT(*) > 1`
    );
    if (dups.rowCount > 0) {
      console.log('⚠ ABORTADO: hay correos duplicados, consolidarlos primero:');
      dups.rows.forEach((r) => console.log(`   ${r.correo} → ${r.n} filas`));
      return;
    }

    const idx = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'EQUIPO_COMERCIAL' AND indexname LIKE '%correo%'`
    );
    console.log('Índices de correo actuales:');
    idx.rows.forEach((r) => console.log('  ', r.indexdef));
    const yaUnico = idx.rows.some((r) => /UNIQUE/i.test(r.indexdef));
    console.log(yaUnico ? '\nYa existe un índice único.' : '\nFalta el índice único.');

    if (!APPLY) {
      console.log('\n--- DRY RUN (sin --apply no se escribe nada) ---');
      if (!yaUnico) {
        console.log('  DROP INDEX IF EXISTS idx_equipo_comercial_correo;');
        console.log('  CREATE UNIQUE INDEX idx_equipo_comercial_correo_uniq ON "EQUIPO_COMERCIAL" (LOWER(TRIM(correo)));');
      }
      return;
    }

    if (!yaUnico) {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_equipo_comercial_correo_uniq"
           ON "EQUIPO_COMERCIAL" (LOWER(TRIM("correo")))`
      );
      // El no-único queda redundante: el único ya sirve para búsquedas por correo.
      await pool.query(`DROP INDEX IF EXISTS "idx_equipo_comercial_correo"`);
      console.log('✅ Índice único creado (y retirado el no-único redundante).');
    } else {
      console.log('✅ Nada que hacer.');
    }
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
