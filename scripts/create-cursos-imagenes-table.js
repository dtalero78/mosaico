/**
 * Crea la tabla CURSOS_IMAGENES: una imagen por TIPO de curso (YOJI/OKINA/
 * KODOMO/DANSHI/SENPAI/IMPULSA). El campo "imagen" guarda la KEY del objeto en
 * DO Spaces (bucket mosaico-bucket, carpeta "Cursos/", p.ej. "Cursos/YOJI.jpg").
 * Idempotente: crea la tabla si no existe y siembra los 6 tipos (imagen=null).
 * Uso: node scripts/create-cursos-imagenes-table.js [--apply]
 */
const { randomUUID } = require('crypto');
const { Pool } = require('pg'); require('dotenv').config({ path: '.env.local' });
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TIPOS = ['YOJI','OKINA','KODOMO','DANSHI','SENPAI','IMPULSA'];
(async()=>{
  if(!apply){ console.log('[dry-run] CREATE TABLE CURSOS_IMAGENES + seed', TIPOS.join(',')); await pool.end(); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CURSOS_IMAGENES" (
      "_id" VARCHAR(60) PRIMARY KEY,
      "tipoCurso" VARCHAR(50) UNIQUE NOT NULL,
      "imagen" TEXT,
      "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
      "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
    )`);
  for(const t of TIPOS){
    await pool.query(
      `INSERT INTO "CURSOS_IMAGENES" ("_id","tipoCurso","imagen") VALUES ($1,$2,NULL)
       ON CONFLICT ("tipoCurso") DO NOTHING`, [randomUUID(), t]);
  }
  const r = await pool.query(`SELECT "tipoCurso","imagen" FROM "CURSOS_IMAGENES" ORDER BY "tipoCurso"`);
  console.log('OK — CURSOS_IMAGENES:'); r.rows.forEach(x=>console.log('  ', x.tipoCurso, '->', x.imagen ?? '(sin imagen)'));
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
