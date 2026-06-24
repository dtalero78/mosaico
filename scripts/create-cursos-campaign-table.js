/**
 * Migración MOSAICO — tabla CURSOS_CAMPAIGN (catálogo campaña → curso → horario).
 *
 * Alimenta los dropdowns en cascada de Crear Contrato:
 *   campaña vigente (activa=true) → cursos disponibles → horarios disponibles.
 *
 * `paraMenores=true` (YOJI/OKINA/KODOMO) → NO seleccionable cuando el titular
 * es el beneficiario (solo IMPULSA/DANSHI/SENPAI son para adultos).
 *
 * La administración completa (alta/baja de campañas) será un proceso aparte;
 * esta tabla es el modelo de datos + un seed mínimo para que Crear Contrato
 * funcione desde ya.
 *
 * Uso: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/create-cursos-campaign-table.js
 * Idempotente: CREATE TABLE IF NOT EXISTS + seed con ON CONFLICT DO NOTHING.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const { Pool } = require('pg');

// [campaign, tipoCurso, horarioCurso, paraMenores]
const SEED = [
  ['VERANO2026', 'IMPULSA', 'Lun-Mié-Vie 18:00', false],
  ['VERANO2026', 'IMPULSA', 'Mar-Jue 19:00', false],
  ['VERANO2026', 'DANSHI', 'Sáb 10:00', false],
  ['VERANO2026', 'SENPAI', 'Sáb 12:00', false],
  ['VERANO2026', 'YOJI', 'Sáb 09:00', true],
  ['VERANO2026', 'OKINA', 'Sáb 11:00', true],
  ['VERANO2026', 'KODOMO', 'Dom 10:00', true],
  ['OTONO2026', 'IMPULSA', 'Lun-Mié 20:00', false],
  ['OTONO2026', 'DANSHI', 'Sáb 15:00', false],
  ['OTONO2026', 'YOJI', 'Sáb 08:00', true],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "CURSOS_CAMPAIGN" (
        "_id" VARCHAR(50) PRIMARY KEY,
        "campaign" VARCHAR(120) NOT NULL,
        "tipoCurso" VARCHAR(50) NOT NULL,
        "horarioCurso" VARCHAR(120) NOT NULL,
        "activa" BOOLEAN DEFAULT true,
        "paraMenores" BOOLEAN DEFAULT false,
        "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
        "_updatedDate" TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE ("campaign", "tipoCurso", "horarioCurso")
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cursos_campaign_activa ON "CURSOS_CAMPAIGN"("activa", "campaign")`);
    console.log('✅ Tabla CURSOS_CAMPAIGN lista (o ya existía).');

    let n = 0;
    for (const [campaign, tipoCurso, horario, paraMenores] of SEED) {
      const res = await pool.query(
        `INSERT INTO "CURSOS_CAMPAIGN" ("_id","campaign","tipoCurso","horarioCurso","activa","paraMenores")
         VALUES ($1,$2,$3,$4,true,$5)
         ON CONFLICT ("campaign","tipoCurso","horarioCurso") DO NOTHING`,
        [`ccp_${crypto.randomUUID()}`, campaign, tipoCurso, horario, paraMenores]
      );
      if (res.rowCount > 0) n++;
    }
    const total = await pool.query(`SELECT COUNT(*)::int c FROM "CURSOS_CAMPAIGN"`);
    console.log(`✅ Seed: ${n} fila(s) nueva(s). Total CURSOS_CAMPAIGN: ${total.rows[0].c}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
