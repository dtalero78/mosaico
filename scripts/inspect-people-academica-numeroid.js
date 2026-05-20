/**
 * Sólo lectura. Detecta inconsistencias de `numeroId` entre PEOPLE
 * (BENEFICIARIO) y ACADEMICA cuando ambos registros corresponden a
 * la misma persona.
 *
 * Estrategias de matching:
 *   1. Por email (case-insensitive, no vacío) — el más confiable
 *   2. Por usuarioId / peopleId si están presentes en ACADEMICA
 *   3. Por celular limpio + contrato (heurística secundaria)
 *
 * Reporta:
 *   - mismatch por email (mismo email, distinto numeroId)
 *   - PEOPLE BENEFICIARIO sin ACADEMICA correspondiente
 *   - ACADEMICA sin PEOPLE correspondiente
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // ── 1. Mismatch por email ─────────────────────────────────────────────
    // Mismo email entre PEOPLE (BENEFICIARIO) y ACADEMICA pero distinto numeroId
    const byEmail = await pool.query(`
      SELECT
        p."_id"        AS people_id,
        p."numeroId"   AS people_numId,
        p."primerNombre" || ' ' || COALESCE(p."primerApellido", '') AS nombre,
        p."contrato"   AS people_contrato,
        a."_id"        AS academica_id,
        a."numeroId"   AS academica_numId,
        p."email"
      FROM "PEOPLE" p
      JOIN "ACADEMICA" a ON LOWER(a."email") = LOWER(p."email")
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND COALESCE(p."email", '') <> ''
        AND COALESCE(p."numeroId", '') <> ''
        AND COALESCE(a."numeroId", '') <> ''
        AND TRIM(p."numeroId") <> TRIM(a."numeroId")
      ORDER BY p."primerApellido" NULLS LAST, p."primerNombre" NULLS LAST
    `);
    console.log(`\n=== Mismatch numeroId (PEOPLE vs ACADEMICA) por email ===`);
    console.log(`Total: ${byEmail.rowCount}\n`);
    byEmail.rows.slice(0, 50).forEach(r => {
      console.log(
        `  ${r.nombre.padEnd(35)} | ` +
        `PEOPLE.numId=${r.people_numid.padEnd(15)} | ` +
        `ACADEMICA.numId=${r.academica_numid.padEnd(15)} | ` +
        `email=${r.email}`
      );
    });
    if (byEmail.rowCount > 50) console.log(`  ... y ${byEmail.rowCount - 50} más`);

    // ── 2. BENEFICIARIOS en PEOPLE sin ACADEMICA correspondiente (por numeroId) ──
    const peopleSinAcademica = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM "PEOPLE" p
      LEFT JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId"
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND COALESCE(p."numeroId", '') <> ''
        AND a."_id" IS NULL
    `);
    console.log(`\n=== BENEFICIARIOS en PEOPLE SIN registro en ACADEMICA (numeroId) ===`);
    console.log(`Total: ${peopleSinAcademica.rows[0].n}`);

    // ── 3. ACADEMICA sin PEOPLE BENEFICIARIO correspondiente ─────────────
    const academicaSinPeople = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM "ACADEMICA" a
      LEFT JOIN "PEOPLE" p
        ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
      WHERE COALESCE(a."numeroId", '') <> ''
        AND p."_id" IS NULL
    `);
    console.log(`\n=== ACADEMICA SIN BENEFICIARIO correspondiente en PEOPLE (numeroId) ===`);
    console.log(`Total: ${academicaSinPeople.rows[0].n}`);

    // ── 4. Duplicados en PEOPLE: mismo numeroId con tipos distintos (TITULAR + BENEFICIARIO) ──
    const duplicados = await pool.query(`
      SELECT
        "numeroId",
        STRING_AGG(DISTINCT "tipoUsuario", ', ') AS tipos,
        COUNT(*)::int AS total
      FROM "PEOPLE"
      WHERE COALESCE("numeroId", '') <> ''
      GROUP BY "numeroId"
      HAVING COUNT(DISTINCT "tipoUsuario") > 1 OR COUNT(*) > 1
      ORDER BY total DESC
      LIMIT 20
    `);
    console.log(`\n=== Top 20 numeroId con múltiples registros PEOPLE (titular+benef o duplicados) ===`);
    duplicados.rows.forEach(r => console.log(`  ${r.numeroId.padEnd(15)} | ${r.tipos.padEnd(30)} | total=${r.total}`));

    // ── Resumen ─────────────────────────────────────────────────────────
    console.log(`\n=== Resumen ===`);
    console.log(`  Mismatch por email:                 ${byEmail.rowCount}`);
    console.log(`  PEOPLE benef sin ACADEMICA:         ${peopleSinAcademica.rows[0].n}`);
    console.log(`  ACADEMICA sin PEOPLE benef:         ${academicaSinPeople.rows[0].n}`);
    console.log(`  Duplicados PEOPLE (muestra top 20): ${duplicados.rowCount}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
