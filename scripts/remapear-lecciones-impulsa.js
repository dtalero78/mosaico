/**
 * Re-mapea la LECCIÓN de cada clase de un curso IMPULSA.
 *
 * Aplica la misma regla que `asignarLeccionesImpulsa` (impulsa-calendario.service):
 * el curso avanza por el currículo de NIVELES en UNA sola secuencia, en orden de
 * fecha, y cada clase consume las lecciones que dura —sesión 1, entrenamiento y
 * evaluación 2—. Si el currículo se agota, las clases sobrantes quedan sin lección.
 *
 * SÓLO escribe las 4 columnas de lección de `CALENDARIO`. **No borra eventos, no
 * toca `ACADEMICA_BOOKINGS` y no altera ninguna asistencia** — y lo comprueba:
 * toma una huella de la asistencia antes y después y aborta si cambió.
 *
 * Uso:
 *   node scripts/remapear-lecciones-impulsa.js [--curso=<cursoCampaignId>] [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const APPLY = process.argv.includes('--apply');
const CURSO = arg('curso');

const leccionesDe = (tipo) => {
  const t = String(tipo || '').toUpperCase();
  return t === 'ENTRENAMIENTO' || t === 'EVALUACION' ? 2 : 1;
};
const catEv = (tipo) => {
  const t = String(tipo || '').toUpperCase();
  return t === 'ENTRENAMIENTO' ? 'ENTREN' : t === 'EVALUACION' ? 'EVALUAC'
    : (t === 'SESSION' || t === 'SESION') ? 'MODULO' : null;
};

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

/** Huella de la asistencia del curso: si cambia un solo valor, cambia el número. */
async function huellaAsistencia(cursoId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE b."asistio" IS TRUE OR b."asistencia" IS TRUE)::int asistieron,
            COUNT(*) FILTER (WHERE b."participacion" IS TRUE)::int participaron,
            COUNT(*) FILTER (WHERE b."cancelo" IS TRUE)::int cancelaron,
            COALESCE(MD5(STRING_AGG(b."_id" || ':' || COALESCE(b."asistio"::text,'-') || COALESCE(b."asistencia"::text,'-')
                       || COALESCE(b."participacion"::text,'-') || COALESCE(b."cancelo"::text,'-')
                       || COALESCE(b."calificacion"::text,'-'), '|' ORDER BY b."_id")), '') firma
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
      WHERE c."cursoCampaignId" = $1`, [cursoId]
  );
  return r.rows[0];
}

(async () => {
  const curso = (await pool.query(
    CURSO ? `SELECT "_id","campaign","tipoCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "_id"=$1`
          : `SELECT "_id","campaign","tipoCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE UPPER("tipoCurso")='IMPULSA'`,
    CURSO ? [CURSO] : []
  )).rows[0];
  if (!curso) { console.error('\n  No se encontró el curso.\n'); process.exit(1); }

  const nv = (await pool.query(
    `SELECT "code","step" FROM "NIVELES" WHERE UPPER("curso")='IMPULSA'
      ORDER BY "orden" ASC NULLS LAST, "step" ASC`
  )).rows;
  const ev = (await pool.query(
    `SELECT "_id","fecha"::text f,"tipo","sesionModulo" m,"sesionLeccion" l,"sesionLeccion2" l2
       FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 ORDER BY "dia" ASC, "_id" ASC`, [curso._id]
  )).rows;

  const antes = await huellaAsistencia(curso._id);
  console.log(`\n  ${curso.campaign} ${curso.tipoCurso}/${curso.salon || '—'}`);
  console.log(`  currículo: ${nv.length} lecciones · calendario: ${ev.length} clases`);
  console.log(`  asistencia ANTES: ${antes.total} agendamientos · ${antes.asistieron} asistieron · ${antes.participaron} participaron · ${antes.cancelaron} cancelaron`);

  // Plan
  let cursor = 0, cambios = 0, sinLeccion = 0;
  const plan = [];
  for (const e of ev) {
    if (!catEv(e.tipo)) continue;
    const n = leccionesDe(e.tipo);
    const l1 = nv[cursor], l2 = n === 2 ? nv[cursor + 1] : undefined;
    cursor += n;
    const nuevo = l1 ? `${l1.code} · ${l1.step}${l2 ? ' + ' + l2.step : ''}` : '(sin lección)';
    const viejo = e.l ? `${e.m} · ${e.l}${e.l2 ? ' + ' + e.l2 : ''}` : '(sin lección)';
    if (!l1) sinLeccion++;
    if (nuevo !== viejo) cambios++;
    plan.push({ id: e._id, f: e.f, tipo: e.tipo, viejo, nuevo, l1, l2 });
  }

  console.log(`\n  Cambian de lección: ${cambios} de ${ev.length} clases · quedan sin lección: ${sinLeccion}\n`);
  console.log('    fecha        tipo            antes                          después');
  plan.filter((x) => x.viejo !== x.nuevo).slice(0, 60).forEach((x) => console.log(
    '    ' + x.f + '   ' + String(x.tipo).padEnd(15) + String(x.viejo).padEnd(31) + x.nuevo));

  if (!APPLY) { console.log('\n  Ensayo. Correr con --apply para guardarlo.\n'); await pool.end(); return; }

  for (const x of plan) {
    if (x.viejo === x.nuevo) continue;
    if (!x.l1) {
      await pool.query(
        `UPDATE "CALENDARIO" SET "sesionModulo"=NULL,"sesionLeccion"=NULL,"sesionModulo2"=NULL,"sesionLeccion2"=NULL WHERE "_id"=$1`,
        [x.id]);
    } else {
      await pool.query(
        `UPDATE "CALENDARIO" SET "sesionModulo"=$2,"sesionLeccion"=$3,"sesionModulo2"=$4,"sesionLeccion2"=$5 WHERE "_id"=$1`,
        [x.id, x.l1.code, x.l1.step, x.l2 ? x.l2.code : null, x.l2 ? x.l2.step : null]);
    }
  }

  const despues = await huellaAsistencia(curso._id);
  const igual = antes.firma === despues.firma && antes.total === despues.total;
  console.log(`\n  ${cambios} clase(s) re-mapeadas.`);
  console.log(`  asistencia DESPUÉS: ${despues.total} agendamientos · ${despues.asistieron} asistieron · ${despues.participaron} participaron · ${despues.cancelaron} cancelaron`);
  console.log(`  ${igual ? '✓ La asistencia quedó EXACTAMENTE igual (huella idéntica).' : '⚠ LA ASISTENCIA CAMBIÓ — revisar.'}\n`);
  await pool.end();
  if (!igual) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
