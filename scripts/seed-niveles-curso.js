/**
 * MOSAICO — siembra un curso en NIVELES desde un CSV (genérico, reutilizable).
 *
 * CSV: curso;modulo;descipcionmodulo;leccion;descripcionlession  (separador ';')
 * Mapeo (recomendación A, sin renombrar columnas):
 *   curso              -> NIVELES."curso"
 *   modulo             -> NIVELES."code"              (módulo; el motor lo lee como nivel)
 *   leccion            -> NIVELES."step"              (lección; el motor lo lee como step)
 *   descripcionlession -> NIVELES."description"
 *   descipcionmodulo   -> NIVELES."descripcionModulo" (col nueva)
 *   nº de lección      -> NIVELES."orden"             (define el avance)
 *
 * El CSV viene en codificación MIXTA (Latin-1 + UTF-8): se decodifica byte a byte.
 * Idempotente: borra las filas del curso (leído del CSV) y reinserta.
 *
 * Uso:  node scripts/seed-niveles-curso.js --csv=docs/cursoMosaicoOkina.csv
 *       node scripts/seed-niveles-curso.js --csv=docs/cursoMosaicoOkina.csv --apply
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const csvArg = process.argv.find(a => a.startsWith('--csv='));
if (!csvArg) { console.error('Falta --csv=ruta/al/archivo.csv'); process.exit(1); }
const CSV = path.isAbsolute(csvArg.slice(6)) ? csvArg.slice(6) : path.join(process.cwd(), csvArg.slice(6));

function smartDecode(buf) {
  let out = '';
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
    let len = 0;
    if ((b & 0xe0) === 0xc0) len = 2;
    else if ((b & 0xf0) === 0xe0) len = 3;
    else if ((b & 0xf8) === 0xf0) len = 4;
    if (len && i + len <= buf.length) {
      let ok = true;
      for (let k = 1; k < len; k++) if ((buf[i + k] & 0xc0) !== 0x80) { ok = false; break; }
      if (ok) { out += buf.slice(i, i + len).toString('utf8'); i += len; continue; }
    }
    out += Buffer.from([b]).toString('latin1');
    i++;
  }
  return out;
}

function parseRows() {
  const text = smartDecode(fs.readFileSync(CSV));
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  lines.shift(); // header
  const rows = [];
  for (const line of lines) {
    const p = line.split(';');
    if (p.length < 5) continue;
    const curso = p[0].trim();
    const modulo = p[1].trim();
    const descMod = p[2].trim();
    const leccion = p[3].trim();
    const descLec = p.slice(4).join(';').trim().replace(/[}\s]+$/, '').trim();
    const m = leccion.match(/(\d+)/);
    const orden = m ? parseInt(m[1], 10) : rows.length + 1;
    rows.push({ curso, modulo, descMod, leccion, descLec, orden });
  }
  return rows;
}

(async () => {
  const rows = parseRows();
  if (rows.length === 0) { console.error('CSV sin filas válidas.'); process.exit(1); }
  const CURSO = rows[0].curso;
  console.log(`CSV: ${rows.length} lecciones parseadas (curso ${CURSO}).`);
  const porModulo = {};
  for (const r of rows) porModulo[r.modulo] = (porModulo[r.modulo] || 0) + 1;
  console.log('Por módulo:', Object.entries(porModulo).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('Inicio (donde nace un alumno):',
    JSON.stringify({ code: rows[0].modulo, step: rows[0].leccion, orden: rows[0].orden }));
  console.log('Muestra:');
  [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].forEach(r =>
    console.log(`  orden ${r.orden} | ${r.modulo} | ${r.leccion} | ${r.descLec.slice(0, 55)}`));

  if (!APPLY) {
    console.log('\n(dry-run) No se escribió nada. Re-ejecuta con --apply.');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "descripcionModulo" TEXT`);
    await pool.query(`ALTER TABLE "NIVELES" DROP CONSTRAINT IF EXISTS "NIVELES_code_key"`);
    await pool.query(`DELETE FROM "NIVELES" WHERE "curso" = $1`, [CURSO]);
    let n = 0;
    for (const r of rows) {
      const id = `niv_${CURSO}_${String(r.orden).padStart(3, '0')}`;
      await pool.query(
        `INSERT INTO "NIVELES" ("_id","curso","code","step","description","descripcionModulo",
           "orden","esParalelo","origen","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,'POSTGRES',NOW(),NOW())`,
        [id, r.curso, r.modulo, r.leccion, r.descLec, r.descMod, r.orden]
      );
      n++;
    }
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_niveles_curso_code_step ON "NIVELES" ("curso","code","step")`);
    const c = await pool.query(`SELECT COUNT(*)::int n FROM "NIVELES" WHERE "curso"=$1`, [CURSO]);
    console.log(`\n✅ NIVELES sembrado: ${n} filas. Total curso ${CURSO}: ${c.rows[0].n}.`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
