/**
 * MOSAICO — curso puente WELCOME en NIVELES + ACADEMICA.salon.
 *
 * WELCOME es el curso temporal donde nace ACADEMICA al crear el contrato.
 * Tiene 2 "módulos": MOSAICO (cursos YOJI/OKINA/KODOMO/DANSHI/SENPAI) e IMPULSA.
 * Step = 'Leccion 00'. El salón de WELCOME es 'Salon 00'.
 *
 * También agrega ACADEMICA."salon" (faltaba) para guardar el salón del registro
 * académico ('Salon 00' en WELCOME; el salón real tras promover desde PEOPLE).
 *
 * Uso: node scripts/seed-welcome-niveles.js
 * Idempotente: ADD COLUMN IF NOT EXISTS + borra WELCOME y reinserta.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const ROWS = [
  { id: 'niv_WELCOME_MOSAICO', code: 'MOSAICO', desc: 'Bienvenida cursos MOSAICO (YOJI/OKINA/KODOMO/DANSHI/SENPAI)' },
  { id: 'niv_WELCOME_IMPULSA', code: 'IMPULSA', desc: 'Bienvenida curso IMPULSA' },
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "salon" VARCHAR(100)`);
    console.log('  ✓ ACADEMICA."salon" VARCHAR(100)');

    await pool.query(`ALTER TABLE "NIVELES" DROP CONSTRAINT IF EXISTS "NIVELES_code_key"`);
    await pool.query(`DELETE FROM "NIVELES" WHERE "curso" = 'WELCOME'`);
    for (const r of ROWS) {
      await pool.query(
        `INSERT INTO "NIVELES" ("_id","curso","code","step","description","descripcionModulo",
           "orden","esParalelo","origen","_createdDate","_updatedDate")
         VALUES ($1,'WELCOME',$2,'Leccion 00',$3,$3,0,false,'POSTGRES',NOW(),NOW())`,
        [r.id, r.code, r.desc]
      );
      console.log(`  ✓ NIVELES WELCOME / ${r.code} / Leccion 00`);
    }
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_niveles_curso_code_step ON "NIVELES" ("curso","code","step")`);
    console.log('✅ WELCOME sembrado + ACADEMICA.salon listo.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
