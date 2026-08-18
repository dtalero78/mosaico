/**
 * Pone las claves foráneas de ACADEMICA_BOOKINGS.
 *
 * Uso:
 *   node scripts/add-bookings-foreign-keys.js            # dry-run (por defecto)
 *   node scripts/add-bookings-foreign-keys.js --apply    # aplica
 *
 * Por qué: ACADEMICA_BOOKINGS es la tabla más grande de la base (~52.000 filas) y
 * no tenía NINGUNA clave foránea. Por eso un PATCH de campaña pudo borrar y recrear
 * los eventos de un curso dejando 5.236 agendamientos apuntando a eventos que ya no
 * existían, sin que nada protestara: el guía abrió su sesión y vio «0 estudiantes».
 * La base no podía detenerlo.
 *
 * ON DELETE RESTRICT, no CASCADE (decisión):
 *   Un agendamiento guarda la asistencia de una clase. Con CASCADE, el mismo error
 *   habría BORRADO esos 5.236 en silencio en vez de dejarlos colgando — peor, porque
 *   los huérfanos se pueden reconstruir y la asistencia no. Con RESTRICT la operación
 *   falla en el acto y no se pierde nada. La regla queda: una fila de la que cuelgan
 *   agendamientos no se borra sin borrarlos antes, explícitamente.
 *
 * Sólo sobre las columnas canónicas (`eventoId`, `studentId`), no sobre sus gemelas
 * legacy de Wix (`idEvento`, `idEstudiante`): se verificó que en las 52.000 filas son
 * COPIAS IDÉNTICAS (0 diferencias) y que los 6 sitios que insertan llenan las cuatro,
 * así que restringir también las legacy exigiría dos índices más y dos comprobaciones
 * por borrado sin cubrir ningún caso nuevo.
 *
 * Se agregan con NOT VALID + VALIDATE: el ADD directo toma un lock exclusivo durante
 * todo el escaneo; así el escaneo corre con un lock más débil.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

const FKS = [
  {
    nombre: 'fk_bookings_evento',
    columna: 'eventoId',
    destino: 'CALENDARIO',
    que: 'el evento del calendario',
  },
  {
    nombre: 'fk_bookings_academica',
    columna: 'studentId',
    destino: 'ACADEMICA',
    que: 'el registro académico del alumno',
  },
];

async function main() {
  const url = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, '');
  if (!url) throw new Error('Falta DATABASE_URL en .env.local');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  console.log(APPLY ? '── APLICANDO ──\n' : '── DRY RUN (usa --apply para escribir) ──\n');

  // 1) La base debe estar en cero huérfanos ANTES de restringir.
  let sucio = false;
  for (const fk of FKS) {
    const r = await pool.query(`
      SELECT COUNT(*)::int AS orf FROM "ACADEMICA_BOOKINGS" b
      WHERE b."${fk.columna}" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${fk.destino}" d WHERE d."_id" = b."${fk.columna}")`);
    const orf = r.rows[0].orf;
    console.log(`  ${fk.columna.padEnd(12)} -> ${fk.destino.padEnd(12)} huérfanos: ${orf}`);
    if (orf > 0) sucio = true;
  }
  if (sucio) {
    console.log('\n  ABORTADO: hay huérfanos. Límpialos antes (scripts/limpiar-bookings-huerfanos.js).');
    await pool.end();
    process.exit(1);
  }

  // 2) Índice en la columna referenciante: sin él, cada borrado del padre
  //    recorre la tabla entera para comprobar que no queden hijos.
  console.log('\n  índices necesarios:');
  for (const fk of FKS) {
    const ix = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'ACADEMICA_BOOKINGS' AND indexdef LIKE '%("${fk.columna}"%'`);
    console.log(`    ${fk.columna.padEnd(12)} ${ix.rows.length ? 'ok  ' + ix.rows[0].indexname : 'FALTA'}`);
    if (!ix.rows.length) {
      console.log(`      ABORTADO: crea un índice en "${fk.columna}" antes de restringir.`);
      await pool.end();
      process.exit(1);
    }
  }

  // 3) Alta idempotente
  console.log('\n  claves foráneas:');
  for (const fk of FKS) {
    const ya = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [fk.nombre]);
    if (ya.rows.length) {
      console.log(`    ${fk.nombre.padEnd(24)} ya existe`);
      continue;
    }
    if (!APPLY) {
      console.log(`    ${fk.nombre.padEnd(24)} se crearía: "${fk.columna}" -> "${fk.destino}"("_id") ON DELETE RESTRICT`);
      continue;
    }
    await pool.query(`
      ALTER TABLE "ACADEMICA_BOOKINGS"
      ADD CONSTRAINT "${fk.nombre}"
      FOREIGN KEY ("${fk.columna}") REFERENCES "${fk.destino}"("_id")
      ON DELETE RESTRICT NOT VALID`);
    await pool.query(`ALTER TABLE "ACADEMICA_BOOKINGS" VALIDATE CONSTRAINT "${fk.nombre}"`);
    console.log(`    ${fk.nombre.padEnd(24)} creada y validada (${fk.que})`);
  }

  // 4) Foto final
  const fin = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid = '"ACADEMICA_BOOKINGS"'::regclass AND contype = 'f'
    ORDER BY conname`);
  console.log('\n  estado de ACADEMICA_BOOKINGS:');
  if (!fin.rows.length) console.log('    (sin claves foráneas)');
  fin.rows.forEach(r => console.log(`    ${r.conname}  ${r.def}`));

  await pool.end();
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
