/**
 * Backfill simétrico al de Credito:
 *   Para cada contrato en FINANCIEROS con numeroCuotas = 1,
 *   marcar PEOPLE.plan = 'Contado' a TITULAR + BENEFICIARIOS
 *   donde plan IS NULL o vacío (no sobrescribe valores existentes).
 *
 * Modos:
 *   node scripts/backfill-plan-contado-by-cuotas.js          → dry-run
 *   node scripts/backfill-plan-contado-by-cuotas.js --apply  → ejecuta
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filename, headers, rows) {
  const filepath = path.join(process.cwd(), filename);
  const lines = [headers.join(';')];
  for (const r of rows) lines.push(headers.map(h => csvEscape(r[h])).join(';'));
  fs.writeFileSync(filepath, '﻿' + lines.join('\n'), 'utf8');
  console.log(`  ✓ ${filename} (${rows.length} filas)`);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    const preview = await pool.query(`
      SELECT
        p."_id",
        p."tipoUsuario",
        p."contrato",
        p."numeroId",
        f."numeroCuotas",
        TRIM(p."primerNombre" || ' ' || COALESCE(p."primerApellido", '')) AS nombre
      FROM "FINANCIEROS" f
      JOIN "PEOPLE" p ON p."contrato" = f."contrato"
      WHERE f."numeroCuotas" IS NOT NULL
        AND CAST(f."numeroCuotas" AS INTEGER) = 1
        AND (p."plan" IS NULL OR p."plan" = '')
      ORDER BY p."contrato", p."tipoUsuario" DESC
    `);

    console.log(`Filas afectadas: ${preview.rowCount}`);

    if (preview.rowCount > 0) {
      const porRol = preview.rows.reduce((acc, r) => {
        const k = r.tipoUsuario || 'NULL';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      console.log('Distribución por tipoUsuario:', porRol);

      writeCsv('plan-contado-by-cuotas.csv',
        ['contrato', 'tipoUsuario', 'numeroId', 'nombre', 'numeroCuotas'],
        preview.rows
      );
    }

    if (APPLY && preview.rowCount > 0) {
      const upd = await pool.query(`
        UPDATE "PEOPLE" p
        SET "plan" = 'Contado', "_updatedDate" = NOW()
        FROM "FINANCIEROS" f
        WHERE p."contrato" = f."contrato"
          AND f."numeroCuotas" IS NOT NULL
          AND CAST(f."numeroCuotas" AS INTEGER) = 1
          AND (p."plan" IS NULL OR p."plan" = '')
      `);
      console.log(`\n✓ ${upd.rowCount} filas PEOPLE actualizadas a plan='Contado'`);
    } else if (!APPLY) {
      console.log(`\nDry-run. Para aplicar:\n  node scripts/backfill-plan-contado-by-cuotas.js --apply`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
