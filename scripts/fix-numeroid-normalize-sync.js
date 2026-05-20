/**
 * Normaliza numeroId y sincroniza PEOPLE → ACADEMICA.
 *
 * Política:
 *   - Fuente de verdad: PEOPLE
 *   - Normalización: UPPER + quita '.' '-' y espacios
 *
 * Pasos:
 *   1. Normaliza PEOPLE.numeroId (afecta casos A y B)
 *   2. Normaliza ACADEMICA.numeroId (mismo formato para comparar)
 *   3. Donde PEOPLE.numeroId != ACADEMICA.numeroId (case D):
 *      - actualiza ACADEMICA.numeroId = PEOPLE.numeroId
 *      - SKIP si el email está compartido por múltiples PEOPLE
 *        beneficiarios con numeroId distinto (case C — swap)
 *
 * Dry-run por defecto. Aplica con `node scripts/fix-numeroid-normalize-sync.js --apply`.
 * Flag `--skip-sync` salta el Step 3 (sync ACADEMICA←PEOPLE) — los 24 casos
 * de caso D se dejan para revisión manual.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const SKIP_SYNC = process.argv.includes('--skip-sync');

const NORMALIZE_SQL = `UPPER(REGEXP_REPLACE("numeroId", '[.\\s\\-]', '', 'g'))`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}${SKIP_SYNC ? ' (salta Step 3)' : ''}\n`);

    // ── STEP 1: PEOPLE normalize ──────────────────────────────────────────
    const peopleNormalize = await pool.query(`
      SELECT "_id", "numeroId", ${NORMALIZE_SQL} AS new_numId
      FROM "PEOPLE"
      WHERE COALESCE("numeroId", '') <> ''
        AND "numeroId" <> ${NORMALIZE_SQL}
    `);
    console.log(`STEP 1 — PEOPLE a normalizar: ${peopleNormalize.rowCount}`);
    if (peopleNormalize.rowCount > 0) {
      peopleNormalize.rows.slice(0, 10).forEach(r =>
        console.log(`  ${r._id.slice(0,16)}  "${r.numeroId}" → "${r.new_numid}"`)
      );
      if (peopleNormalize.rowCount > 10) console.log(`  ... y ${peopleNormalize.rowCount - 10} más`);

      if (APPLY) {
        const upd = await pool.query(`
          UPDATE "PEOPLE"
          SET "numeroId" = ${NORMALIZE_SQL},
              "_updatedDate" = NOW()
          WHERE COALESCE("numeroId", '') <> ''
            AND "numeroId" <> ${NORMALIZE_SQL}
        `);
        console.log(`  ✓ PEOPLE actualizados: ${upd.rowCount}`);
      }
    }

    // ── STEP 2: ACADEMICA normalize ───────────────────────────────────────
    const academicaNormalize = await pool.query(`
      SELECT "_id", "numeroId", ${NORMALIZE_SQL} AS new_numId
      FROM "ACADEMICA"
      WHERE COALESCE("numeroId", '') <> ''
        AND "numeroId" <> ${NORMALIZE_SQL}
    `);
    console.log(`\nSTEP 2 — ACADEMICA a normalizar: ${academicaNormalize.rowCount}`);
    if (academicaNormalize.rowCount > 0) {
      academicaNormalize.rows.slice(0, 10).forEach(r =>
        console.log(`  ${r._id.slice(0,16)}  "${r.numeroId}" → "${r.new_numid}"`)
      );
      if (academicaNormalize.rowCount > 10) console.log(`  ... y ${academicaNormalize.rowCount - 10} más`);

      if (APPLY) {
        const upd = await pool.query(`
          UPDATE "ACADEMICA"
          SET "numeroId" = ${NORMALIZE_SQL},
              "_updatedDate" = NOW()
          WHERE COALESCE("numeroId", '') <> ''
            AND "numeroId" <> ${NORMALIZE_SQL}
        `);
        console.log(`  ✓ ACADEMICA actualizados: ${upd.rowCount}`);
      }
    }

    // ── STEP 3: Sync ACADEMICA.numeroId = PEOPLE.numeroId (case D) ───────
    if (SKIP_SYNC) {
      console.log('\nSTEP 3 — SALTADO (flag --skip-sync). Los casos D quedan para revisión manual.');
      return;
    }
    // Email único = sólo un PEOPLE beneficiario con ese email.
    // Si está compartido (case C — swap), se omite.
    const syncCandidates = await pool.query(`
      WITH email_count AS (
        SELECT LOWER(email) AS email_lower, COUNT(DISTINCT "numeroId") AS distinct_nums
        FROM "PEOPLE"
        WHERE "tipoUsuario" = 'BENEFICIARIO'
          AND COALESCE(email, '') <> ''
          AND COALESCE("numeroId", '') <> ''
        GROUP BY LOWER(email)
      )
      SELECT
        p."_id"        AS people_id,
        p."numeroId"   AS people_numId,
        p."primerNombre" || ' ' || COALESCE(p."primerApellido", '') AS nombre,
        a."_id"        AS academica_id,
        a."numeroId"   AS academica_numId,
        LOWER(p."email") AS email_lower
      FROM "PEOPLE" p
      JOIN "ACADEMICA" a ON LOWER(a."email") = LOWER(p."email")
      JOIN email_count ec ON ec.email_lower = LOWER(p."email")
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND COALESCE(p."email", '') <> ''
        AND COALESCE(p."numeroId", '') <> ''
        AND COALESCE(a."numeroId", '') <> ''
        AND TRIM(p."numeroId") <> TRIM(a."numeroId")
        AND ec.distinct_nums = 1
      ORDER BY p."primerApellido" NULLS LAST, p."primerNombre" NULLS LAST
    `);

    console.log(`\nSTEP 3 — Sync ACADEMICA ← PEOPLE (case D, emails únicos): ${syncCandidates.rowCount}`);
    syncCandidates.rows.slice(0, 20).forEach(r =>
      console.log(
        `  ${r.nombre.padEnd(35)} | ACADEMICA "${r.academica_numid}" → "${r.people_numid}"`
      )
    );
    if (syncCandidates.rowCount > 20) console.log(`  ... y ${syncCandidates.rowCount - 20} más`);

    if (APPLY && syncCandidates.rowCount > 0) {
      let updated = 0;
      for (const r of syncCandidates.rows) {
        await pool.query(
          `UPDATE "ACADEMICA"
           SET "numeroId" = $2, "_updatedDate" = NOW()
           WHERE "_id" = $1`,
          [r.academica_id, r.people_numid]
        );
        updated++;
      }
      console.log(`  ✓ ACADEMICA sincronizadas: ${updated}`);
    }

    if (!APPLY) {
      console.log(`\nDry-run completado. Para aplicar:`);
      console.log(`  node scripts/fix-numeroid-normalize-sync.js --apply`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
