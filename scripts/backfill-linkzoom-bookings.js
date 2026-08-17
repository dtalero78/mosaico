/**
 * Copia el link de Zoom del EVENTO al AGENDAMIENTO cuando el agendamiento no lo
 * tiene.
 *
 * El panel del alumno lee `ACADEMICA_BOOKINGS."linkZoom"`, no el del evento
 * ([booking.repository](src/repositories/booking.repository.ts)), así que un
 * agendamiento sin link deja al alumno con el ícono de Zoom apagado aunque el
 * evento sí lo tenga.
 *
 * De dónde viene: el arreglo de jul-2026 que hizo que los eventos de curso
 * heredaran la sala del guía rellenó **CALENDARIO** (6.184 eventos) pero no
 * tocó los agendamientos ya creados. Los que se generaron después sí lo traen
 * — `generarBookingsBeneficiario` copia `e.linkZoom` —, así que esto es sólo
 * reparación de lo viejo, no hay que cambiar código.
 *
 * ⚠ SÓLO rellena vacíos: si el agendamiento ya tiene un link, no se toca (puede
 * ser una sala distinta asignada a propósito). Y sólo sobre eventos de HOY en
 * adelante: el link de una clase que ya pasó no le sirve a nadie y reescribir
 * historia sin necesidad es peor.
 *
 * Uso: node scripts/backfill-linkzoom-bookings.js [--apply] [--dias=1]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const DIAS = Number((process.argv.find(a => a.startsWith('--dias=')) || '--dias=1').split('=')[1]) || 1;
const LOTE = 5000;

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const CRITERIO = `
  FROM "ACADEMICA_BOOKINGS" b
  JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
 WHERE (b."linkZoom" IS NULL OR TRIM(b."linkZoom") = '')
   AND c."linkZoom" IS NOT NULL AND TRIM(c."linkZoom") <> ''
   AND c."dia" >= NOW() - ($1 || ' days')::interval`;

(async () => {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS bookings, COUNT(DISTINCT b."idEstudiante")::int AS alumnos,
            MIN(c."dia")::text AS desde, MAX(c."dia")::text AS hasta ${CRITERIO}`, [DIAS]);
  console.log(`Agendamientos a rellenar: ${r.bookings}  ·  alumnos: ${r.alumnos}`);
  console.log(`Rango de clases: ${String(r.desde).slice(0, 16)} → ${String(r.hasta).slice(0, 16)}\n`);

  const { rows: hoy } = await pool.query(`
    SELECT c."nivel" AS curso, TO_CHAR(c."dia" AT TIME ZONE 'America/Santiago','HH24:MI') AS hora,
           COUNT(*)::int AS alumnos
      ${CRITERIO.replace('WHERE', 'AND TRUE WHERE')}
       AND (c."dia" AT TIME ZONE 'America/Santiago')::date = (NOW() AT TIME ZONE 'America/Santiago')::date
     GROUP BY 1,2 ORDER BY 2,1`.replace('AND TRUE WHERE', 'WHERE'), [DIAS]);
  if (hoy.length) {
    console.log('Clases de HOY afectadas:');
    console.table(hoy);
  }

  if (!APPLY) {
    console.log('\n(dry-run — nada se escribió. Volvé a correr con --apply)');
    await pool.end();
    return;
  }

  // Por lotes: son decenas de miles y el JOIN por (eventoId OR idEvento) es caro.
  let total = 0;
  for (;;) {
    const { rowCount } = await pool.query(`
      UPDATE "ACADEMICA_BOOKINGS" t
         SET "linkZoom" = s."link", "_updatedDate" = NOW()
        FROM (SELECT b."_id" AS bid, c."linkZoom" AS link ${CRITERIO} LIMIT ${LOTE}) s
       WHERE t."_id" = s.bid`, [DIAS]);
    total += rowCount;
    if (!rowCount) break;
    console.log(`  … ${total}`);
  }
  console.log(`\n✓ ${total} agendamiento(s) con el link del evento.`);

  const { rows: [post] } = await pool.query(`SELECT COUNT(*)::int n ${CRITERIO}`, [DIAS]);
  console.log(`Quedan sin link (evento con link, agendamiento sin él): ${post.n}`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
