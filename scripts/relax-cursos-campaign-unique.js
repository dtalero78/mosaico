/**
 * relax-cursos-campaign-unique.js — la identidad de un curso pasa a ser
 * (campaña, tipo, horario, SALÓN): dos salones del mismo tipo pueden compartir horario.
 *
 * Reemplaza la restricción UNIQUE (campaign, tipoCurso, horarioCurso) por un índice único
 * con el salón (COALESCE para que dos cursos sin salón tampoco se dupliquen).
 * Ejecutar DESPUÉS de desplegar el código que ya distingue por salón.
 *
 * Idempotente. Dry-run por defecto; --apply escribe.
 * Uso: node scripts/relax-cursos-campaign-unique.js [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const prefijados = (await c.query(`SELECT "_id","salon" FROM "CURSOS_CAMPAIGN" WHERE "salon" ~* '^sal[oó]n'`)).rows;
    const personas = (await c.query(`SELECT COUNT(*)::int n FROM "PEOPLE" WHERE "salon" ~* '^sal[oó]n'`)).rows[0].n;
    console.log(`CURSOS_CAMPAIGN con prefijo "Salon": ${prefijados.length} · PEOPLE: ${personas}`);
    const cons = (await c.query(`SELECT conname FROM pg_constraint WHERE conrelid='"CURSOS_CAMPAIGN"'::regclass AND contype='u'`)).rows.map(r => r.conname);
    const idx = (await c.query(`SELECT 1 FROM pg_indexes WHERE tablename='CURSOS_CAMPAIGN' AND indexname='cursos_campaign_identidad_uq'`)).rowCount > 0;
    console.log('Restricciones únicas:', cons.join(', ') || '—', '· índice nuevo:', idx ? 'ya existe' : 'no existe');
    if (!APPLY) { console.log('[dry-run] usa --apply'); return; }
    await c.query('BEGIN');
    await c.query(`SET LOCAL lock_timeout = '5s'`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "cursos_campaign_identidad_uq"
      ON "CURSOS_CAMPAIGN" ("campaign","tipoCurso","horarioCurso",(COALESCE("salon",'')))`);
    for (const n of cons) if (/campaign.*tipoCurso.*horarioCurso/i.test(n)) await c.query(`ALTER TABLE "CURSOS_CAMPAIGN" DROP CONSTRAINT "${n}"`);
    await c.query('COMMIT');
    console.log('✔ identidad = campaña + tipo + horario + salón');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { await c.end(); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
