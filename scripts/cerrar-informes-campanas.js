/**
 * Cierra en bloque los informes del Reporte Académico de las campañas que se
 * indiquen (o de todas MENOS las que se excluyan).
 *
 * Para qué: cuando una campaña todavía no tiene los alumnos definidos, sus
 * informes semanales no se pueden generar bien y sólo ensucian el listado de
 * "Reporte Académico sin gestión". Cerrarlos los saca del pendiente sin borrar
 * nada de lo ya escrito.
 *
 * Qué escribe: una fila en REPORTE_ACADEMICO_CIERRE por cada (curso, salón,
 * campaña, semana) que tuvo clase y no está cerrado, con estado **DEFINITIVO** y
 * `cerradoAdminPor` = quien lo ejecuta. Se usa DEFINITIVO y no CERRADO_GUIA
 * porque es una decisión administrativa, no trabajo del guía: marcarlo como
 * "cerrado por el guía" dejaría el informe a la espera de una revisión que nadie
 * pidió, y además atribuiría a otra persona algo que no hizo.
 *
 * Lo que NO toca: las valoraciones ya escritas (REPORTE_ACADEMICO_NOTAS) se
 * conservan intactas — cerrar sólo marca el estado del salón.
 *
 * ⚠ El estado del informe SÓLO AVANZA desde la interfaz: una vez en DEFINITIVO no
 * hay forma de reabrirlo desde la app. Para deshacerlo hay que borrar las filas
 * de REPORTE_ACADEMICO_CIERRE con un script.
 *
 * Ensayo por defecto.
 *   node scripts/cerrar-informes-campanas.js --excepto=AGOSTO172026M --por=correo@x.com
 *   node scripts/cerrar-informes-campanas.js --excepto=AGOSTO172026M --por=correo@x.com --apply
 *   node scripts/cerrar-informes-campanas.js --campanas=ABRIL132026M,JUNIO082026M --por=... --apply
 */
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : null;
};
const APPLY = process.argv.includes('--apply');
const EXCEPTO = (arg('excepto') || '').split(',').map((s) => s.trim()).filter(Boolean);
const CAMPANAS = (arg('campanas') || '').split(',').map((s) => s.trim()).filter(Boolean);
const POR = (arg('por') || '').trim();

if (!EXCEPTO.length && !CAMPANAS.length) {
  console.error('Falta --excepto=CAMPAÑA[,...] o --campanas=CAMPAÑA[,...]');
  process.exit(1);
}
if (APPLY && !POR) {
  console.error('Falta --por=<correo de quien cierra> (queda registrado en cada fila).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

/**
 * Mismo universo que el informe "Reporte Académico sin gestión": los (salón,
 * semana) que TUVIERON clase y no están cerrados. IMPULSA queda fuera porque no
 * usa el Reporte Académico.
 */
const SQL_PENDIENTES = `
  WITH semanas AS (
    SELECT cc."campaign", cc."tipoCurso" AS curso, cc."salon",
           (date_trunc('week', c."dia")::date) AS "semanaInicio"
      FROM "CALENDARIO" c
      JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
     WHERE c."dia" < NOW()
       AND UPPER(COALESCE(cc."tipoCurso",'')) <> 'IMPULSA'
       AND ($1::text[] IS NULL OR cc."campaign" = ANY($1::text[]))
       AND ($2::text[] IS NULL OR NOT (cc."campaign" = ANY($2::text[])))
     GROUP BY 1,2,3,4
  )
  SELECT s.* FROM semanas s
   WHERE NOT EXISTS (
     SELECT 1 FROM "REPORTE_ACADEMICO_CIERRE" ci
      WHERE ci."curso" = s.curso AND ci."salon" = s."salon"
        AND ci."campaign" = s."campaign" AND ci."semanaInicio" = s."semanaInicio"
        AND ci."estado" IN ('CERRADO_GUIA','DEFINITIVO'))
   ORDER BY s."campaign", s."semanaInicio", s.curso, s."salon"`;

(async () => {
  const params = [CAMPANAS.length ? CAMPANAS : null, EXCEPTO.length ? EXCEPTO : null];
  const { rows } = await pool.query(SQL_PENDIENTES, params);

  const porCampana = {};
  for (const r of rows) porCampana[r.campaign] = (porCampana[r.campaign] || 0) + 1;
  console.log(`\nInformes a cerrar: ${rows.length}`);
  Object.entries(porCampana).sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`   ${String(c).padEnd(20)} ${String(n).padStart(5)}`));

  // Las valoraciones ya escritas se conservan: se reporta cuántas hay para que
  // quede claro que cerrar no borra trabajo del guía.
  if (rows.length) {
    const { rows: nn } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "REPORTE_ACADEMICO_NOTAS" n
        WHERE ($1::text[] IS NULL OR n."campaign" = ANY($1::text[]))
          AND ($2::text[] IS NULL OR n."campaign" IS NULL OR NOT (n."campaign" = ANY($2::text[])))`,
      params);
    console.log(`\n   Valoraciones ya escritas en ese alcance: ${nn[0].n} (NO se tocan)`);
  }

  if (!rows.length) { console.log('\nNada que cerrar.\n'); await pool.end(); return; }
  if (!APPLY) {
    console.log('\nEnsayo. Correr con --apply --por=<correo> para escribir.\n');
    await pool.end(); return;
  }

  const client = await pool.connect();
  let escritos = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        // `cerradoMasivo` marca que fue una decisión administrativa en bloque: así
        // el contador de Gestión Coordinación no se lo carga al Guía.
        `INSERT INTO "REPORTE_ACADEMICO_CIERRE"
           ("_id","curso","salon","campaign","semanaInicio","estado","cerradoAdminPor","cerradoAdminEn","cerradoMasivo")
         VALUES ($1,$2,$3,$4,$5,'DEFINITIVO',$6,NOW(),true)
         ON CONFLICT ("curso","salon","campaign","semanaInicio") DO NOTHING`,
        [`rac_${crypto.randomUUID()}`, r.curso, r.salon, r.campaign, r.semanaInicio, POR]);
      escritos++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const { rows: quedan } = await pool.query(SQL_PENDIENTES, params);
  console.log(`\n✓ Cerrados ${escritos}. Pendientes que quedan en ese alcance: ${quedan.length}\n`);
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
