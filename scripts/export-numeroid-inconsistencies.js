/**
 * Exporta a CSV las inconsistencias entre PEOPLE y ACADEMICA que NO se
 * arreglan automáticamente con fix-numeroid-normalize-sync.js. Son
 * casos que requieren revisión manual.
 *
 * Archivos generados (en el directorio raíz del proyecto):
 *   - numeroid-case-c-emails-compartidos.csv     (case C — email swaps)
 *   - numeroid-beneficiarios-sin-academica.csv   (sin registro ACADEMICA)
 *   - numeroid-academica-sin-beneficiario.csv    (sin registro PEOPLE)
 *   - numeroid-duplicados-people.csv             (mismo numeroId, múltiples PEOPLE)
 *   - numeroid-case-d-sync-pendiente.csv         (24 candidatos sync ACADEMICA←PEOPLE,
 *                                                 emails únicos, distintos numeroId — Step 3 saltado)
 *
 * Sólo lectura. No modifica nada.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(filename, headers, rows) {
  const filepath = path.join(process.cwd(), filename);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  // BOM UTF-8 para que Excel lea acentos correctamente
  fs.writeFileSync(filepath, '﻿' + lines.join('\n'), 'utf8');
  console.log(`  ✓ ${filename} (${rows.length} filas)`);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log('Exportando inconsistencias numeroId a CSV...\n');

    // ── 1. Case C: emails compartidos por múltiples PEOPLE benefiarios con distintos numeroId ──
    const caseC = await pool.query(`
      WITH email_count AS (
        SELECT LOWER(email) AS email_lower, COUNT(DISTINCT "numeroId") AS distinct_nums
        FROM "PEOPLE"
        WHERE "tipoUsuario" = 'BENEFICIARIO'
          AND COALESCE(email, '') <> ''
          AND COALESCE("numeroId", '') <> ''
        GROUP BY LOWER(email)
        HAVING COUNT(DISTINCT "numeroId") > 1
      )
      SELECT
        p."_id"          AS people_id,
        p."numeroId"     AS people_numeroId,
        p."primerNombre" AS primerNombre,
        p."primerApellido" AS primerApellido,
        LOWER(p."email") AS email_lower,
        p."contrato"     AS contrato,
        a."_id"          AS academica_id,
        a."numeroId"     AS academica_numeroId
      FROM "PEOPLE" p
      LEFT JOIN "ACADEMICA" a ON LOWER(a."email") = LOWER(p."email")
      JOIN email_count ec ON ec.email_lower = LOWER(p."email")
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
      ORDER BY LOWER(p."email"), p."primerApellido", p."primerNombre"
    `);
    console.log(`Case C — Emails compartidos por múltiples benefiarios: ${caseC.rowCount}`);
    writeCsv(
      'numeroid-case-c-emails-compartidos.csv',
      ['email_lower', 'people_id', 'people_numeroid', 'primernombre', 'primerapellido', 'contrato', 'academica_id', 'academica_numeroid'],
      caseC.rows
    );

    // ── 2. BENEFICIARIOS en PEOPLE sin ACADEMICA correspondiente ──
    const sinAcademica = await pool.query(`
      SELECT
        p."_id"          AS people_id,
        p."numeroId"     AS people_numeroId,
        p."primerNombre" AS primerNombre,
        p."primerApellido" AS primerApellido,
        p."email"        AS email,
        p."celular"      AS celular,
        p."contrato"     AS contrato,
        p."plataforma"   AS plataforma,
        p."tipoUsuario"  AS tipoUsuario,
        p."estado"       AS estado,
        p."aprobacion"   AS aprobacion,
        p."estadoInactivo" AS estadoInactivo
      FROM "PEOPLE" p
      LEFT JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId"
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND COALESCE(p."numeroId", '') <> ''
        AND a."_id" IS NULL
      ORDER BY p."primerApellido" NULLS LAST, p."primerNombre" NULLS LAST
    `);
    console.log(`Beneficiarios sin ACADEMICA: ${sinAcademica.rowCount}`);
    writeCsv(
      'numeroid-beneficiarios-sin-academica.csv',
      ['people_id', 'people_numeroid', 'primernombre', 'primerapellido', 'email', 'celular', 'contrato', 'plataforma', 'tipousuario', 'estado', 'aprobacion', 'estadoinactivo'],
      sinAcademica.rows
    );

    // ── 3. ACADEMICA sin PEOPLE BENEFICIARIO correspondiente ──
    const sinBenef = await pool.query(`
      SELECT
        a."_id"          AS academica_id,
        a."numeroId"     AS academica_numeroId,
        a."primerNombre" AS primerNombre,
        a."primerApellido" AS primerApellido,
        a."email"        AS email,
        a."celular"      AS celular,
        a."contrato"     AS contrato,
        a."plataforma"   AS plataforma,
        a."nivel"        AS nivel,
        a."step"         AS step,
        a."estadoInactivo" AS estadoInactivo
      FROM "ACADEMICA" a
      LEFT JOIN "PEOPLE" p
        ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
      WHERE COALESCE(a."numeroId", '') <> ''
        AND p."_id" IS NULL
      ORDER BY a."primerApellido" NULLS LAST, a."primerNombre" NULLS LAST
    `);
    console.log(`ACADEMICA sin beneficiario PEOPLE: ${sinBenef.rowCount}`);
    writeCsv(
      'numeroid-academica-sin-beneficiario.csv',
      ['academica_id', 'academica_numeroid', 'primernombre', 'primerapellido', 'email', 'celular', 'contrato', 'plataforma', 'nivel', 'step', 'estadoinactivo'],
      sinBenef.rows
    );

    // ── 4. Duplicados: mismo numeroId con múltiples registros en PEOPLE ──
    const duplicados = await pool.query(`
      WITH dups AS (
        SELECT "numeroId"
        FROM "PEOPLE"
        WHERE COALESCE("numeroId", '') <> ''
        GROUP BY "numeroId"
        HAVING COUNT(*) > 1
      )
      SELECT
        p."_id"          AS people_id,
        p."numeroId"     AS people_numeroId,
        p."primerNombre" AS primerNombre,
        p."primerApellido" AS primerApellido,
        p."tipoUsuario"  AS tipoUsuario,
        p."email"        AS email,
        p."celular"      AS celular,
        p."contrato"     AS contrato,
        p."plataforma"   AS plataforma,
        p."estado"       AS estado,
        p."aprobacion"   AS aprobacion,
        p."estadoInactivo" AS estadoInactivo
      FROM "PEOPLE" p
      JOIN dups ON dups."numeroId" = p."numeroId"
      ORDER BY p."numeroId", p."tipoUsuario", p."primerApellido", p."primerNombre"
    `);
    console.log(`Duplicados PEOPLE (filas totales): ${duplicados.rowCount}`);
    writeCsv(
      'numeroid-duplicados-people.csv',
      ['people_id', 'people_numeroid', 'primernombre', 'primerapellido', 'tipousuario', 'email', 'celular', 'contrato', 'plataforma', 'estado', 'aprobacion', 'estadoinactivo'],
      duplicados.rows
    );

    // ── 5. Case D pendiente: sync ACADEMICA←PEOPLE no aplicado (Step 3 saltado) ──
    const caseD = await pool.query(`
      WITH email_count AS (
        SELECT LOWER(email) AS email_lower, COUNT(DISTINCT "numeroId") AS distinct_nums
        FROM "PEOPLE"
        WHERE "tipoUsuario" = 'BENEFICIARIO'
          AND COALESCE(email, '') <> ''
          AND COALESCE("numeroId", '') <> ''
        GROUP BY LOWER(email)
      )
      SELECT
        p."_id"          AS people_id,
        p."numeroId"     AS people_numeroId,
        p."primerNombre" AS primerNombre,
        p."primerApellido" AS primerApellido,
        LOWER(p."email") AS email_lower,
        p."contrato"     AS contrato,
        p."plataforma"   AS plataforma,
        a."_id"          AS academica_id,
        a."numeroId"     AS academica_numeroId
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
    console.log(`Case D pendiente — sync ACADEMICA←PEOPLE: ${caseD.rowCount}`);
    writeCsv(
      'numeroid-case-d-sync-pendiente.csv',
      ['people_id', 'people_numeroid', 'primernombre', 'primerapellido', 'email_lower', 'contrato', 'plataforma', 'academica_id', 'academica_numeroid'],
      caseD.rows
    );

    console.log('\n✓ Exportación completa.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
