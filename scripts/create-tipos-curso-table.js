#!/usr/bin/env node
/**
 * Saca el catálogo de tipos de curso del código a una tabla administrable.
 *
 * Estaba escrito en `TIPOS_CURSO` (src/lib/cursos-campaign.ts), así que cargar el
 * currículo de un curso nuevo en NIVELES no bastaba: no aparecía en ningún
 * desplegable ni pasaba las validaciones del servidor, y habilitarlo exigía tocar
 * código y desplegar. Mismo camino que ya se hizo con HORARIOS_CURSO.
 *
 * Dos reglas viajan con el curso porque NO se deducen del currículo:
 *   esMenores    → si el titular puede ser su propio alumno al crear el contrato
 *   usaApoderado → si el WhatsApp (bienvenida, recordatorios) va al apoderado
 * Hoy NO coinciden: DANSHI no es de menores pero sus mensajes sí van al apoderado.
 *
 * El seed reproduce EXACTAMENTE lo que hace el código hoy, para que activar la
 * tabla no cambie el comportamiento de ningún curso existente.
 *
 * Uso:
 *   node scripts/create-tipos-curso-table.js           (ensayo)
 *   node scripts/create-tipos-curso-table.js --apply
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')
const { randomUUID } = require('crypto')

const APPLY = process.argv.includes('--apply')

// tipoCurso, esMenores, usaApoderado, orden
// Los 6 primeros replican TIPOS_CURSO + CURSOS_MENORES + cursoUsaApoderadoParaMensajes.
const SEED = [
  ['YOJI',          true,  true,  1],
  ['OKINA',         true,  true,  2],
  ['KODOMO',        true,  true,  3],
  ['DANSHI',        false, true,  4],
  ['SENPAI',        false, false, 5],
  ['IMPULSA',       false, false, 6],
  ['DANSHI-SENPAI', false, false, 7],
]

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const { rows: [t] } = await client.query(
      `SELECT to_regclass('public."TIPOS_CURSO_CATALOGO"') AS t`)
    const existe = !!t.t
    console.log(`Tabla TIPOS_CURSO_CATALOGO: ${existe ? 'ya existe' : 'se creará'}`)

    let yaHay = []
    if (existe) {
      yaHay = (await client.query(`SELECT "tipoCurso" FROM "TIPOS_CURSO_CATALOGO"`)).rows.map(r => r.tipoCurso)
    }
    console.log('\nFilas del seed:')
    for (const [tipo, men, apo, ord] of SEED) {
      const est = yaHay.includes(tipo) ? '✓ ya está' : '+ se creará'
      console.log(`  ${est.padEnd(12)} ${tipo.padEnd(15)} menores=${String(men).padEnd(5)} apoderado=${String(apo).padEnd(5)} orden=${ord}`)
    }

    if (!APPLY) { console.log('\nENSAYO — nada se escribió. Agrega --apply.'); return }

    await client.query(`
      CREATE TABLE IF NOT EXISTS "TIPOS_CURSO_CATALOGO" (
        "_id"           VARCHAR(255) PRIMARY KEY,
        "tipoCurso"     VARCHAR(60)  NOT NULL,
        "esMenores"     BOOLEAN      NOT NULL DEFAULT false,
        "usaApoderado"  BOOLEAN      NOT NULL DEFAULT false,
        "orden"         INTEGER      NOT NULL DEFAULT 999,
        "activo"        BOOLEAN      NOT NULL DEFAULT true,
        "_createdDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "_updatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )`)
    // El nombre del curso ES la llave de negocio: aparece como texto en
    // CURSOS_CAMPAIGN, PEOPLE, ACADEMICA y NIVELES. Dos filas con el mismo
    // nombre harían ambiguo a cuál pertenece un alumno.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_tipos_curso_nombre"
                          ON "TIPOS_CURSO_CATALOGO" (UPPER(TRIM("tipoCurso")))`)
    console.log('  ✓ tabla e índice')

    // Inserta sólo lo que falta POR NOMBRE. El _id es aleatorio, así que un
    // ON CONFLICT sobre el PK nunca chocaría y duplicaría en cada corrida.
    // Re-correr no pisa lo que el admin haya cambiado después.
    let creadas = 0
    for (const [tipo, men, apo, ord] of SEED) {
      const res = await client.query(
        `INSERT INTO "TIPOS_CURSO_CATALOGO" ("_id","tipoCurso","esMenores","usaApoderado","orden")
         SELECT $1::varchar, $2::varchar, $3::boolean, $4::boolean, $5::integer
          WHERE NOT EXISTS (SELECT 1 FROM "TIPOS_CURSO_CATALOGO"
                             WHERE UPPER(TRIM("tipoCurso")) = UPPER(TRIM($2::varchar)))`,
        [`tcc_${randomUUID()}`, tipo, men, apo, ord])
      creadas += res.rowCount || 0
    }
    console.log(`  ✓ ${creadas} fila(s) creada(s)`)

    const fin = (await client.query(
      `SELECT "tipoCurso","esMenores","usaApoderado","orden","activo"
         FROM "TIPOS_CURSO_CATALOGO" ORDER BY "orden"`)).rows
    console.log('\nCatálogo final:')
    fin.forEach(r => console.log(`  ${String(r.orden).padStart(2)}. ${r.tipoCurso.padEnd(15)} menores=${String(r.esMenores).padEnd(5)} apoderado=${String(r.usaApoderado).padEnd(5)} ${r.activo ? 'activo' : 'INACTIVO'}`))
    console.log('\n✓ Aplicado.')
  } catch (e) {
    console.error('ERROR:', e.message); process.exitCode = 1
  } finally {
    client.release(); await pool.end()
  }
})()
