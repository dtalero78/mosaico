/**
 * Bulk bloqueo de contratos desde CSV.
 *
 * Aplica la MISMA lógica que `/admin/bloqueo-contrato` y `bloqueo-contrato.service.ts`:
 *   1. Por cada contrato único en el CSV:
 *      a. Busca el titular.
 *      b. Si titular.finalContrato >= hoy → SKIP (inconsistencia, deja constancia).
 *      c. Busca beneficiarios del contrato.
 *      d. Cada beneficiario:
 *         - finalContrato coincide con titular → BLOQUEAR
 *         - finalContrato difiere y < hoy (extensión vencida) → BLOQUEAR
 *         - finalContrato difiere y >= hoy (extensión vigente) → SKIP (respeta)
 *   2. Por cada persona a bloquear:
 *      - PEOPLE: estadoInactivo=true, aprobacion='FINALIZADA', estado='FINALIZADA'
 *      - ACADEMICA (por numeroId): estadoInactivo=true
 *      - USUARIOS_ROLES (por email): activo=false
 *
 * CSV esperado en el cwd: `Arreglo Bloqueo.csv` con separador `;` y header.
 *
 * Modos:
 *   node scripts/bulk-bloqueo-from-csv.js             → dry-run
 *   node scripts/bulk-bloqueo-from-csv.js --apply     → ejecuta
 *
 * Genera siempre `bulk-bloqueo-resultado.csv` con el detalle por persona.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const CSV_INPUT = path.join(process.cwd(), 'Arreglo Bloqueo.csv');
const CSV_OUTPUT = path.join(process.cwd(), 'bulk-bloqueo-resultado.csv');

function readCsv(filepath) {
  let raw = fs.readFileSync(filepath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = lines[0].split(';');
  return lines.slice(1).map(line => {
    const cols = line.split(';');
    const obj = {};
    header.forEach((h, i) => { obj[h.trim()] = (cols[i] ?? '').trim(); });
    return obj;
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function writeResult(rows) {
  const headers = ['contrato', 'people_id', 'numeroId', 'nombre', 'role', 'finalContrato', 'accion', 'reason', 'success', 'error'];
  const lines = [headers.join(';')];
  for (const r of rows) lines.push(headers.map(h => csvEscape(r[h])).join(';'));
  fs.writeFileSync(CSV_OUTPUT, '﻿' + lines.join('\n'), 'utf8');
}

function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateOnly(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function isExpired(finalContrato) {
  if (!finalContrato) return false;
  const final = new Date(finalContrato);
  final.setUTCHours(0, 0, 0, 0);
  return final.getTime() < todayUtc().getTime();
}

function fullName(p) {
  return `${p.primerNombre || ''} ${p.primerApellido || ''}`.trim() || '(sin nombre)';
}

(async () => {
  if (!fs.existsSync(CSV_INPUT)) {
    console.error(`❌ No existe ${CSV_INPUT}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const resultRows = [];

  try {
    console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    const csv = readCsv(CSV_INPUT);
    const contratos = Array.from(new Set(csv.map(r => r.contrato).filter(Boolean)));
    console.log(`Contratos únicos en CSV: ${contratos.length}\n`);

    let stats = {
      contratosOk: 0,
      contratosSkip: 0,
      contratosError: 0,
      personasBloqueadas: 0,
      personasSkipExtension: 0,
      personasYaBloqueadas: 0,
      personasError: 0,
    };

    for (let i = 0; i < contratos.length; i++) {
      const contrato = contratos[i];

      // 1. Buscar titular
      const titularesRes = await pool.query(
        `SELECT "_id", "primerNombre", "primerApellido", "numeroId",
                "finalContrato", "estadoInactivo", "email"
         FROM "PEOPLE"
         WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
         LIMIT 1`,
        [contrato]
      );

      if (titularesRes.rowCount === 0) {
        stats.contratosError++;
        resultRows.push({ contrato, people_id: '', numeroId: '', nombre: '(titular no encontrado)', role: 'TITULAR', finalContrato: '', accion: 'ERROR', reason: 'titular_not_found', success: false, error: 'No existe titular para este contrato' });
        console.log(`[${i+1}/${contratos.length}] ${contrato} → ❌ Titular no encontrado`);
        continue;
      }

      const titular = titularesRes.rows[0];
      const titularFinal = dateOnly(titular.finalContrato);

      // 2. Validar titular vencido
      if (!titularFinal) {
        stats.contratosSkip++;
        resultRows.push({ contrato, people_id: titular._id, numeroId: titular.numeroId, nombre: fullName(titular), role: 'TITULAR', finalContrato: '', accion: 'SKIP', reason: 'sin_finalcontrato', success: false, error: 'Titular sin finalContrato' });
        console.log(`[${i+1}/${contratos.length}] ${contrato} → ⏭️  Titular sin finalContrato`);
        continue;
      }
      if (!isExpired(titularFinal)) {
        stats.contratosSkip++;
        resultRows.push({ contrato, people_id: titular._id, numeroId: titular.numeroId, nombre: fullName(titular), role: 'TITULAR', finalContrato: titularFinal, accion: 'SKIP', reason: 'titular_no_vencido', success: false, error: `Titular aún vigente (vence ${titularFinal})` });
        console.log(`[${i+1}/${contratos.length}] ${contrato} → ⏭️  Titular vigente (${titularFinal})`);
        continue;
      }

      stats.contratosOk++;

      // 3. Buscar beneficiarios
      const benefRes = await pool.query(
        `SELECT "_id", "primerNombre", "primerApellido", "numeroId",
                "finalContrato", "estadoInactivo", "email"
         FROM "PEOPLE"
         WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'`,
        [contrato]
      );

      const personasAEvaluar = [
        { p: titular, role: 'TITULAR' },
        ...benefRes.rows.map(b => ({ p: b, role: 'BENEFICIARIO' })),
      ];

      let bloqueoEnEsteContrato = 0;

      for (const { p, role } of personasAEvaluar) {
        const pFinal = dateOnly(p.finalContrato);
        let accion = 'BLOCK';
        let reason = role === 'TITULAR' ? 'titular_expired' : 'matches_titular';

        if (role === 'BENEFICIARIO') {
          if (pFinal && pFinal !== titularFinal) {
            // Extensión individual
            if (isExpired(pFinal)) {
              reason = 'own_expired';
            } else {
              accion = 'SKIP';
              reason = 'extension_active';
            }
          }
        }

        if (accion === 'SKIP') {
          stats.personasSkipExtension++;
          resultRows.push({ contrato, people_id: p._id, numeroId: p.numeroId, nombre: fullName(p), role, finalContrato: pFinal, accion: 'SKIP', reason, success: true, error: '' });
          continue;
        }

        // BLOCK
        const yaBloqueado = p.estadoInactivo === true;

        if (!APPLY) {
          if (yaBloqueado) stats.personasYaBloqueadas++;
          else stats.personasBloqueadas++;
          resultRows.push({ contrato, people_id: p._id, numeroId: p.numeroId, nombre: fullName(p), role, finalContrato: pFinal, accion: yaBloqueado ? 'ALREADY_BLOCKED' : 'WOULD_BLOCK', reason, success: true, error: '' });
          bloqueoEnEsteContrato++;
          continue;
        }

        // APPLY
        try {
          await pool.query(
            `UPDATE "PEOPLE"
             SET "estadoInactivo" = true, "aprobacion" = 'FINALIZADA', "estado" = 'FINALIZADA', "_updatedDate" = NOW()
             WHERE "_id" = $1`,
            [p._id]
          );
          // ACADEMICA y USUARIOS_ROLES son una sola fila por persona física.
          // Si la misma persona figura también como BENEFICIARIO activo en otro contrato
          // (o como beneficiario de sí mismo con extensión vigente), NO debemos inactivar
          // sus tablas compartidas. Verificamos antes de cada UPDATE.
          if (p.numeroId) {
            const otroActivo = await pool.query(
              `SELECT 1 FROM "PEOPLE"
               WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
                 AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)
                 AND "_id" <> $2
               LIMIT 1`,
              [p.numeroId, p._id]
            );
            if (otroActivo.rowCount === 0) {
              await pool.query(
                `UPDATE "ACADEMICA" SET "estadoInactivo" = true, "_updatedDate" = NOW()
                 WHERE "numeroId" = $1`,
                [p.numeroId]
              ).catch(() => {});
            }
          }
          if (p.email) {
            const otroLogin = await pool.query(
              `SELECT 1 FROM "PEOPLE"
               WHERE LOWER("email") = LOWER($1) AND "tipoUsuario" = 'BENEFICIARIO'
                 AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)
                 AND "_id" <> $2
               LIMIT 1`,
              [p.email, p._id]
            );
            if (otroLogin.rowCount === 0) {
              await pool.query(
                `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
                 WHERE LOWER("email") = LOWER($1)`,
                [p.email]
              ).catch(() => {});
            }
          }
          if (yaBloqueado) stats.personasYaBloqueadas++;
          else stats.personasBloqueadas++;
          resultRows.push({ contrato, people_id: p._id, numeroId: p.numeroId, nombre: fullName(p), role, finalContrato: pFinal, accion: yaBloqueado ? 'RE_BLOCKED' : 'BLOCKED', reason, success: true, error: '' });
          bloqueoEnEsteContrato++;
        } catch (err) {
          stats.personasError++;
          resultRows.push({ contrato, people_id: p._id, numeroId: p.numeroId, nombre: fullName(p), role, finalContrato: pFinal, accion: 'ERROR', reason, success: false, error: err.message });
        }
      }

      if ((i + 1) % 50 === 0 || i === contratos.length - 1) {
        console.log(`[${i+1}/${contratos.length}] procesados — bloqueos hasta ahora: ${stats.personasBloqueadas}`);
      }
    }

    console.log('\n=== RESUMEN ===');
    console.log(`Contratos OK (titular vencido):                ${stats.contratosOk}`);
    console.log(`Contratos saltados (titular vigente/sin fecha):${stats.contratosSkip}`);
    console.log(`Contratos con error (titular no encontrado):   ${stats.contratosError}`);
    console.log(`Personas ${APPLY ? 'bloqueadas' : 'a bloquear'}:                       ${stats.personasBloqueadas}`);
    console.log(`Personas ya bloqueadas (re-procesadas):        ${stats.personasYaBloqueadas}`);
    console.log(`Beneficiarios saltados (extensión vigente):    ${stats.personasSkipExtension}`);
    console.log(`Personas con error:                            ${stats.personasError}`);

    writeResult(resultRows);
    console.log(`\n✓ Detalle escrito en: ${path.relative(process.cwd(), CSV_OUTPUT)}`);

    if (!APPLY) {
      console.log(`\nDry-run. Para aplicar:\n  node scripts/bulk-bloqueo-from-csv.js --apply`);
    }
  } catch (e) {
    console.error('ERROR:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
