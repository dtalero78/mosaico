/**
 * MOSAICO — importa guías a la tabla GUIAS desde docs/Guias.csv.
 *
 * CSV (separador ';', algunos campos entre comillas con ';' dentro, encoding Latin-1):
 *   nombre;email;clave;cuentaZoom;claveZoom
 *
 * Mapeo → GUIAS: nombreCompleto←nombre, email←email, clave←clave,
 *   cuentaZoom←cuentaZoom, claveZoom←claveZoom, activo=true.
 *   primerNombre/primerApellido se derivan del nombre (solo para compat ADVISORS;
 *   el dropdown usa nombreCompleto). _id generado (gui_<uuid>).
 *
 * Upsert por LOWER(email): re-ejecutar actualiza, no duplica.
 *
 * Uso:  node scripts/import-guias-csv.js            (dry-run, muestra el plan)
 *       node scripts/import-guias-csv.js --apply    (escribe en GUIAS)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const CSV_PATH = path.join(process.cwd(), 'docs', 'Guias.csv');

// Parser de una línea CSV con delimitador ';' respetando comillas dobles.
function parseLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ';') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

(async () => {
  const apply = process.argv.includes('--apply');

  // Leer como Latin-1 para decodificar Ñ/Á correctamente.
  const raw = fs.readFileSync(CSV_PATH, 'latin1');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = parseLine(lines[0]).map(h => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iNombre = idx('nombre'), iEmail = idx('email'), iClave = idx('clave'),
    iCuenta = idx('cuentazoom'), iClaveZoom = idx('clavezoom');

  const registros = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    const nombre = (c[iNombre] || '').trim();
    const email = (c[iEmail] || '').trim();
    if (!nombre || !email) continue;
    const tokens = nombre.split(/\s+/).filter(Boolean);
    registros.push({
      _id: `gui_${randomUUID()}`,
      nombreCompleto: nombre,
      primerNombre: tokens[0] || nombre,
      primerApellido: tokens.length > 1 ? tokens[tokens.length - 1] : '',
      email,
      clave: (c[iClave] || '').trim() || null,
      cuentaZoom: (c[iCuenta] || '').trim() || null,
      claveZoom: (c[iClaveZoom] || '').trim() || null,
    });
  }

  console.log(`📄 ${CSV_PATH}`);
  console.log(`   ${registros.length} guía(s) parseadas:`);
  registros.forEach(r => console.log(`   • ${r.nombreCompleto}  <${r.email}>  zoom:${r.cuentaZoom || '—'}`));

  if (!apply) {
    console.log('\n(dry-run) No se escribió nada. Ejecuta con --apply para guardar en GUIAS.');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    // Asegurar columnas extra (idempotente).
    for (const col of ['clave', 'cuentaZoom', 'claveZoom']) {
      await pool.query(`ALTER TABLE "GUIAS" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    }
    let ins = 0, upd = 0;
    for (const r of registros) {
      const ex = await pool.query(`SELECT "_id" FROM "GUIAS" WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`, [r.email]);
      if (ex.rows.length > 0) {
        await pool.query(
          `UPDATE "GUIAS" SET "nombreCompleto"=$2,"primerNombre"=$3,"primerApellido"=$4,
             "clave"=$5,"cuentaZoom"=$6,"claveZoom"=$7,"activo"=true,"_updatedDate"=NOW()
           WHERE "_id"=$1`,
          [ex.rows[0]._id, r.nombreCompleto, r.primerNombre, r.primerApellido, r.clave, r.cuentaZoom, r.claveZoom]
        );
        upd++;
      } else {
        await pool.query(
          `INSERT INTO "GUIAS" ("_id","nombreCompleto","primerNombre","primerApellido","email","clave","cuentaZoom","claveZoom","activo","_createdDate","_updatedDate")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())`,
          [r._id, r.nombreCompleto, r.primerNombre, r.primerApellido, r.email, r.clave, r.cuentaZoom, r.claveZoom]
        );
        ins++;
      }
    }
    const { rows } = await pool.query(`SELECT COUNT(*)::int c FROM "GUIAS"`);
    console.log(`\n✅ Importado. Insertadas: ${ins}, Actualizadas: ${upd}. Total GUIAS: ${rows[0].c}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
