/**
 * MOSAICO — Corte propio de "dos lecciones por clase de dos horas" por curso.
 *
 * Agrega CURSOS_CAMPAIGN."dosBloquesDesde" (DATE, NULL = regla global por campaña).
 * Con valor, el curso reparte dos lecciones por sesión de 2 h DESDE esa fecha y no
 * antes (lo ya dictado conserva su lección). Idempotente; ensayo por defecto.
 *
 * Uso:
 *   node scripts/add-cursos-dos-bloques-desde.js [--apply]
 *   node scripts/add-cursos-dos-bloques-desde.js --marcar=2026-10-31 [--apply]
 *     → además fija el corte en los salones de SÁBADO (2 h) de campañas anteriores
 *       a agosto-2026 (YOJI, OKINA, KODOMO, DANSHI, SENPAI) que aún tienen clases
 *       desde esa fecha.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const marcar = (process.argv.find(a => a.startsWith('--marcar=')) || '').split('=')[1] || null;
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  const ya = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='CURSOS_CAMPAIGN' AND column_name='dosBloquesDesde'`)).rowCount > 0;
  console.log(ya ? 'Columna dosBloquesDesde ya existe.' : 'Columna dosBloquesDesde NO existe → se crea.');
  if (APPLY && !ya) {
    await pool.query(`SET lock_timeout='5s'`);
    await pool.query(`ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "dosBloquesDesde" DATE`);
    console.log('✅ columna creada');
  }
  if (marcar) {
    const col = (APPLY || ya) ? '' : '';
    const sel = `SELECT cc."_id", cc."tipoCurso", cc."campaign", cc."salon", cc."horarioCurso"
        FROM "CURSOS_CAMPAIGN" cc
       WHERE cc."activa" AND cc."tipoCurso" IN ('YOJI','OKINA','KODOMO','DANSHI','SENPAI')
         AND cc."horarioCurso" ILIKE 'S_B%' AND cc."inicioCurso" < '2026-08-01'
         AND EXISTS (SELECT 1 FROM "CALENDARIO" c WHERE c."cursoCampaignId"=cc."_id" AND c."dia" >= $1::date)
       ORDER BY 2,3,4`;
    const cs = (await pool.query(sel, [marcar])).rows;
    console.log(`Salones a marcar con corte ${marcar}: ${cs.length}`);
    for (const c of cs) console.log(`  ${c.tipoCurso} ${c.campaign} ${c.salon} ${c.horarioCurso}  (${c._id})`);
    if (APPLY) {
      const r = await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "dosBloquesDesde"=$1::date WHERE "_id" = ANY($2)`, [marcar, cs.map(c => c._id)]);
      console.log(`✅ ${r.rowCount} salones marcados`);
    } else console.log('(ensayo) nada escrito; --apply para aplicar');
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
