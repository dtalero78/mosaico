/**
 * MOSAICO — siembra el curso YOJI en NIVELES desde docs/cursoMosaicoYoji.csv.
 *
 * Mapeo (recomendación A, sin renombrar columnas):
 *   curso              -> NIVELES."curso"             (= "YOJI")
 *   modulo             -> NIVELES."code"              (módulo; el motor lo lee como nivel)
 *   leccion            -> NIVELES."step"              (lección; el motor lo lee como step)
 *   descripcionlession -> NIVELES."description"       (descripción de la lección)
 *   descipcionmodulo   -> NIVELES."descripcionModulo" (columna NUEVA)
 *   nº de lección      -> NIVELES."orden"             (1..72, define el avance)
 *
 * El CSV viene en codificación MIXTA (Latin-1 + UTF-8): se decodifica byte a byte
 * (secuencias UTF-8 válidas como UTF-8, bytes altos sueltos como Latin-1).
 *
 * Idempotente: borra las filas de curso=YOJI y reinserta.
 * Uso:  node scripts/seed-niveles-yoji.js            (dry-run: solo muestra)
 *       node scripts/seed-niveles-yoji.js --apply    (escribe en NIVELES)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const CSV = path.join(process.cwd(), 'docs', 'cursoMosaicoYoji.csv');
const CURSO = 'YOJI';

// Decodifica un Buffer con codificación mixta UTF-8/Latin-1.
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
    out += Buffer.from([b]).toString('latin1'); // byte alto suelto = Latin-1
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
  console.log(`CSV: ${rows.length} lecciones parseadas (curso ${CURSO}).`);
  // Resumen por módulo
  const porModulo = {};
  for (const r of rows) porModulo[r.modulo] = (porModulo[r.modulo] || 0) + 1;
  console.log('Por módulo:', Object.entries(porModulo).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('Primera fila (donde inicia un alumno):',
    JSON.stringify({ code: rows[0].modulo, step: rows[0].leccion, orden: rows[0].orden, desc: rows[0].descLec.slice(0, 50) }));
  console.log('Muestra (lecciones con tildes/emoji):');
  [rows[0], rows[23], rows[47], rows[71]].forEach(r =>
    console.log(`  orden ${r.orden} | ${r.modulo} | ${r.leccion} | ${r.descLec.slice(0, 60)}`));

  if (!APPLY) {
    console.log('\n(dry-run) No se escribió nada. Re-ejecuta con --apply para sembrar NIVELES.');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "descripcionModulo" TEXT`);
    // El UNIQUE(code) del seed bloquea el modelo MOSAICO (un módulo = N lecciones).
    // En el motor (LGS) `code` NO es único. Se elimina y se usa la llave natural
    // correcta (curso, code, step) = una lección por (curso, módulo, lección).
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
    // Llave natural correcta: una lección por (curso, módulo, lección)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_niveles_curso_code_step ON "NIVELES" ("curso","code","step")`);
    const c = await pool.query(`SELECT COUNT(*)::int n FROM "NIVELES" WHERE "curso"=$1`, [CURSO]);
    console.log(`\n✅ NIVELES sembrado: ${n} filas insertadas. Total curso ${CURSO}: ${c.rows[0].n}.`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
