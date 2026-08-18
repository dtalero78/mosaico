/**
 * Normaliza los cursos cuyo `guia` es el TEXTO "null"/"undefined" a NULL de verdad.
 *
 * Uso:
 *   node scripts/limpiar-guia-null-texto.js            # dry-run
 *   node scripts/limpiar-guia-null-texto.js --apply
 *
 * Por qué: el formulario podía mandar el valor no elegido convertido a cadena, y
 * quedaba guardado como un guía cuyo id es «null». Para la verificación de
 * colisiones eso NO era «sin guía»: era una persona, así que cualquier curso nuevo
 * sin guía lo encontraba y sacaba el aviso de «el guía ya tiene otro curso a esa
 * hora». El código ya no lo interpreta como guía (`lib/guia.ts`) y al guardar se
 * normaliza, pero conviene dejar el dato limpio: así el valor coincide con lo que
 * significa y no reaparece en ningún informe que mire la columna en crudo.
 *
 * NO toca los cursos con `guia` NULL o vacío (ya están bien) ni los que apuntan a
 * un guía real.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

// La misma regla que usa la app, importada — no copiada.
const { guiaAsignado } = require('../src/lib/guia.ts');

const APPLY = process.argv.includes('--apply');

async function main() {
  const url = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, '');
  if (!url) throw new Error('Falta DATABASE_URL en .env.local');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  console.log(APPLY ? '── APLICANDO ──\n' : '── DRY RUN (usa --apply para escribir) ──\n');

  const { rows } = await pool.query(`
    SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
           cc."guia", cc."activa"
    FROM "CURSOS_CAMPAIGN" cc
    WHERE cc."guia" IS NOT NULL AND TRIM(cc."guia") <> ''
    ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`);

  // Se filtra en JS con la regla de la app: así el script y la app no pueden divergir.
  const aLimpiar = rows.filter(r => guiaAsignado(r.guia) === null);

  if (!aLimpiar.length) {
    console.log('  No hay cursos con el texto "null"/"undefined" como guía. Nada que hacer.');
    await pool.end();
    return;
  }

  console.log(`  Cursos a normalizar: ${aLimpiar.length}\n`);
  aLimpiar.forEach(r => console.log(
    `    ${r.campaign} · ${r.tipoCurso} · Salón ${r.salon || '—'} · ${r.horarioCurso}` +
    `   guia=${JSON.stringify(r.guia)}  activa=${r.activa}`));

  if (!APPLY) {
    console.log('\n  (dry-run) No se escribió nada.');
    await pool.end();
    return;
  }

  const ids = aLimpiar.map(r => r._id);
  const r = await pool.query(
    `UPDATE "CURSOS_CAMPAIGN" SET "guia" = NULL, "_updatedDate" = NOW()
      WHERE "_id" = ANY($1::text[])`, [ids]);
  console.log(`\n  Actualizados: ${r.rowCount}`);

  const quedan = await pool.query(`
    SELECT COUNT(*)::int n FROM "CURSOS_CAMPAIGN"
    WHERE LOWER(TRIM(COALESCE("guia",''))) IN ('null','undefined','none','-')`);
  console.log(`  Quedan con texto "null": ${quedan.rows[0].n}`);

  await pool.end();
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
