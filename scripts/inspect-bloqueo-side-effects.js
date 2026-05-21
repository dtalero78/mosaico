/**
 * Sólo lectura. Detecta efectos colaterales del bulk-bloqueo:
 * beneficiarios cuyo PEOPLE quedó correctamente activo (extensión vigente)
 * pero su ACADEMICA o USUARIOS_ROLES fueron inactivados porque comparten
 * numeroId/email con un titular bloqueado del mismo contrato.
 *
 * Genera dos CSVs:
 *   - casos-a-revisar.csv               → todos los casos especiales del bulk
 *   - bloqueo-side-effects.csv          → beneficiarios afectados por colateral
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const RESULTADO_CSV = path.join(process.cwd(), 'bulk-bloqueo-resultado.csv');

function readCsv(filepath, sep = ';') {
  let raw = fs.readFileSync(filepath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = lines[0].split(sep);
  return lines.slice(1).map(line => {
    // simple split — los campos no contienen sep escapado en este CSV
    const cols = line.split(sep);
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
    if (!fs.existsSync(RESULTADO_CSV)) {
      console.error(`No existe ${RESULTADO_CSV}. Corre primero scripts/bulk-bloqueo-from-csv.js`);
      process.exit(1);
    }

    const rows = readCsv(RESULTADO_CSV);

    // ── 1. Casos a revisar: contratos saltados / con error ────────────
    const especiales = rows.filter(r =>
      r.accion === 'SKIP' && (r.reason === 'titular_no_vencido' || r.reason === 'sin_finalcontrato') ||
      r.accion === 'ERROR'
    );
    writeCsv('casos-a-revisar.csv',
      ['contrato', 'people_id', 'numeroId', 'nombre', 'role', 'finalContrato', 'accion', 'reason', 'error'],
      especiales
    );
    console.log(`Casos especiales (titular vigente/sin fecha/error): ${especiales.length}\n`);

    // ── 2. Detectar efectos colaterales ────────────────────────────────
    // Beneficiarios saltados por extensión vigente
    const skippedBenef = rows.filter(r =>
      r.accion === 'SKIP' && r.reason === 'extension_active' && r.role === 'BENEFICIARIO'
    );
    console.log(`Beneficiarios respetados por extensión vigente: ${skippedBenef.length}`);

    // Contratos que sí fueron procesados (titular bloqueado o ya bloqueado)
    const contratosBloqueados = new Set(
      rows.filter(r => r.role === 'TITULAR' && (r.accion === 'BLOCKED' || r.accion === 'RE_BLOCKED'))
          .map(r => r.contrato)
    );

    // Para cada beneficiario respetado:
    //   - Buscar si su numeroId aparece en otro TITULAR bloqueado del mismo contrato
    //   - Y verificar el estado ACTUAL de ACADEMICA + USUARIOS_ROLES
    const affected = [];

    for (let i = 0; i < skippedBenef.length; i++) {
      const r = skippedBenef[i];
      if (!contratosBloqueados.has(r.contrato)) continue;

      // PEOPLE actual del beneficiario
      const peopleRes = await pool.query(
        `SELECT "_id", "numeroId", "email", "estadoInactivo", "primerNombre", "primerApellido",
                TO_CHAR("finalContrato", 'YYYY-MM-DD') AS "finalContrato"
         FROM "PEOPLE" WHERE "_id" = $1`,
        [r.people_id]
      );
      if (peopleRes.rowCount === 0) continue;
      const benef = peopleRes.rows[0];
      // Si el beneficiario está inactivo en PEOPLE, no es side-effect (es bloqueo real)
      if (benef.estadoInactivo === true) continue;

      // Hay TITULAR bloqueado del MISMO contrato con MISMO numeroId o MISMO email?
      const sharedRes = await pool.query(
        `SELECT "_id", "tipoUsuario", "numeroId", "email", "estadoInactivo"
         FROM "PEOPLE"
         WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
           AND "estadoInactivo" = true
           AND (
             ("numeroId" IS NOT NULL AND "numeroId" = $2) OR
             ("email" IS NOT NULL AND LOWER("email") = LOWER($3))
           )
         LIMIT 1`,
        [r.contrato, benef.numeroId, benef.email]
      );
      if (sharedRes.rowCount === 0) continue;

      // Verificar ACADEMICA y USUARIOS_ROLES
      const academica = benef.numeroId
        ? (await pool.query(
            `SELECT "_id", "estadoInactivo" FROM "ACADEMICA" WHERE "numeroId" = $1`,
            [benef.numeroId]
          )).rows[0]
        : null;
      const usuario = benef.email
        ? (await pool.query(
            `SELECT "email", "activo" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1)`,
            [benef.email]
          )).rows[0]
        : null;

      const academicaInactiva = academica?.estadoInactivo === true;
      const usuarioBloqueado = usuario?.activo === false;

      if (academicaInactiva || usuarioBloqueado) {
        affected.push({
          contrato: r.contrato,
          people_id_benef: benef._id,
          numeroId: benef.numeroId,
          nombre: `${benef.primerNombre || ''} ${benef.primerApellido || ''}`.trim(),
          finalContrato_benef: benef.finalContrato,
          email: benef.email || '',
          academica_id: academica?._id || '',
          academica_inactiva: academicaInactiva ? 'SI' : 'no',
          usuario_bloqueado: usuarioBloqueado ? 'SI' : 'no',
          titular_id: sharedRes.rows[0]._id,
        });
      }
    }

    writeCsv('bloqueo-side-effects.csv',
      ['contrato', 'people_id_benef', 'numeroId', 'nombre', 'finalContrato_benef', 'email', 'academica_id', 'academica_inactiva', 'usuario_bloqueado', 'titular_id'],
      affected
    );
    console.log(`\nEfectos colaterales detectados (beneficiarios afectados): ${affected.length}`);
    console.log(`  - ACADEMICA inactivada: ${affected.filter(a => a.academica_inactiva === 'SI').length}`);
    console.log(`  - USUARIOS_ROLES bloqueado: ${affected.filter(a => a.usuario_bloqueado === 'SI').length}`);
  } catch (e) {
    console.error('ERROR:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
