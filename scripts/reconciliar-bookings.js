/**
 * MOSAICO — Reconciliación de agendamientos (bookings) faltantes.
 *
 * Problema: los bookings de un beneficiario se generan al aprobar. Si el
 * beneficiario se aprobó ANTES de materializarse los eventos del curso, o se
 * promovió desde WELCOME por una vía que no generaba bookings, quedó con menos
 * bookings que eventos y nada lo reintentaba.
 *
 * Este script busca beneficiarios APROBADOS + ACTIVOS cuyo nº de bookings del
 * curso sea MENOR al nº de eventos del curso, y crea SOLO los que faltan
 * (idempotente: dedupe por eventoId; NO toca asistencia/estado de los existentes).
 * Replica exactamente el INSERT de `generarBookingsBeneficiario`.
 *
 * ⚠ Crear un booking sobre una sesión YA DICTADA la deja marcada como AUSENCIA
 * retroactiva de alguien que nunca estuvo inscrito. Por eso existe
 * `--solo-futuros`: crea únicamente los de sesiones que aún no han ocurrido, que
 * es lo que deja al alumno operativo de hoy en adelante sin ensuciar su historial.
 *
 * Uso:
 *   node scripts/reconciliar-bookings.js --campaign=AGOSTO172026M [--apply]
 *   node scripts/reconciliar-bookings.js --solo-futuros [--apply]
 *   node scripts/reconciliar-bookings.js                 (todas las campañas, dry-run)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const campArg = (process.argv.find(a => a.startsWith('--campaign=')) || '').split('=')[1] || null;
// Sólo sesiones futuras: evita marcar ausencias retroactivas en cursos en marcha.
const SOLO_FUTUROS = process.argv.includes('--solo-futuros');
const NORM = (c) => `REPLACE(REPLACE(REPLACE(${c},'.',''),'-',''),' ','')`;
let seq = 0;
const bkgId = () => `bkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${(seq++).toString(36)}`;

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  // Candidatos: beneficiarios aprobados+activos resueltos a curso con eventos, con gap.
  const cand = (await pool.query(
    `WITH ben AS (
       SELECT p."_id" pid, p."numeroId", p."campaign", p."tipoCurso", p."horarioCurso",
              p."primerNombre", p."primerApellido", p."celular", p."plataforma"
         FROM "PEOPLE" p
        WHERE p."tipoUsuario"='BENEFICIARIO'
          AND LOWER(COALESCE(p."aprobacion",'')) IN ('aprobado','aprobada')
          AND p."estadoInactivo" IS NOT TRUE
          AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
          ${campArg ? `AND p."campaign" = $1` : ``}
     ),
     wc AS (
       SELECT ben.*, cc."_id" ccid,
              (SELECT COUNT(*)::int FROM "CALENDARIO" c WHERE c."cursoCampaignId"=cc."_id") n_ev
         FROM ben JOIN "CURSOS_CAMPAIGN" cc
           ON cc."campaign"=ben."campaign" AND cc."tipoCurso"=ben."tipoCurso" AND cc."horarioCurso"=ben."horarioCurso"
     ),
     wa AS (
       SELECT wc.*, a.acaid FROM wc
       JOIN LATERAL (
         SELECT a."_id" acaid FROM "ACADEMICA" a
          WHERE ${NORM('a."numeroId"')}=${NORM('wc."numeroId"')} AND a."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') LIMIT 1
       ) a ON true
       WHERE wc.n_ev > 0
     )
     SELECT wa.*, nb.n_bk FROM wa
     JOIN LATERAL (
       SELECT COUNT(*)::int n_bk FROM "ACADEMICA_BOOKINGS" b
         JOIN "CALENDARIO" c ON (c."_id"=b."eventoId" OR c."_id"=b."idEvento")
        WHERE (b."idEstudiante"=wa.acaid OR b."studentId"=wa.acaid) AND c."cursoCampaignId"=wa.ccid
     ) nb ON true
     WHERE nb.n_bk < wa.n_ev
     ORDER BY wa."campaign", wa."tipoCurso"`,
    campArg ? [campArg] : []
  )).rows;

  const porCampaign = {};
  for (const c of cand) { const k = `${c.campaign} / ${c.tipoCurso}`; porCampaign[k] = porCampaign[k] || { n: 0, falt: 0 }; porCampaign[k].n++; porCampaign[k].falt += (c.n_ev - c.n_bk); }
  console.log(`── Reconciliación${campArg ? ' ('+campArg+')' : ''} ──`);
  console.log(`Beneficiarios con bookings faltantes: ${cand.length}`);
  if (SOLO_FUTUROS) console.log('⚠ modo --solo-futuros: los totales de abajo son el hueco COMPLETO; sólo se crearán los de sesiones futuras.');
  for (const [k, v] of Object.entries(porCampaign)) console.log(`  ${k.padEnd(24)} alumnos=${v.n}  bookings_a_crear≈${v.falt}`);

  if (!APPLY) { console.log('\n(dry-run) — nada escrito. --apply para crear los bookings faltantes.'); await pool.end(); return; }

  const COLS = ['_id','eventoId','idEvento','studentId','idEstudiante','primerNombre','primerApellido','numeroId','celular','plataforma','nivel','step','advisor','fecha','fechaEvento','hora','tipo','tipoEvento','linkZoom','nombreEvento','tituloONivel','asistio','asistencia','participacion','noAprobo','cancelo','agendadoPor','fechaAgendamiento','origen'];
  let totalBk = 0, alumnosOk = 0, errores = 0;

  for (const c of cand) {
    try {
      const ev = (await pool.query(
        `SELECT "_id","advisor","dia","hora","tipo","evento","nivel","step","tituloONivel","nombreEvento","titulo","linkZoom"
           FROM "CALENDARIO" WHERE "cursoCampaignId"=$1
           ${SOLO_FUTUROS ? 'AND "dia" >= NOW()' : ''}`, [c.ccid]
      )).rows;
      const existing = (await pool.query(
        `SELECT "eventoId","idEvento" FROM "ACADEMICA_BOOKINGS" WHERE ("idEstudiante"=$1 OR "studentId"=$1)`, [c.acaid]
      )).rows;
      const yaTiene = new Set();
      for (const r of existing) { if (r.eventoId) yaTiene.add(r.eventoId); if (r.idEvento) yaTiene.add(r.idEvento); }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const e of ev) {
          if (yaTiene.has(e._id)) continue;
          const data = {
            _id: bkgId(), eventoId: e._id, idEvento: e._id, studentId: c.acaid, idEstudiante: c.acaid,
            primerNombre: c.primerNombre || null, primerApellido: c.primerApellido || null, numeroId: c.numeroId || null,
            celular: c.celular || null, plataforma: c.plataforma || null,
            nivel: e.nivel || e.tituloONivel || null, step: e.step || e.nombreEvento || null,
            advisor: e.advisor || '', fecha: e.dia, fechaEvento: e.dia, hora: e.hora || null,
            tipo: e.tipo || e.evento || null, tipoEvento: e.tipo || e.evento || null, linkZoom: e.linkZoom || null,
            nombreEvento: e.nombreEvento || e.titulo || null, tituloONivel: e.tituloONivel || null,
            asistio: false, asistencia: false, participacion: false, noAprobo: false, cancelo: false,
            agendadoPor: 'Sistema (reconciliación bookings)', fechaAgendamiento: new Date().toISOString(), origen: 'POSTGRES',
          };
          const vals = COLS.map(k => data[k]);
          const ph = COLS.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO "ACADEMICA_BOOKINGS" (${COLS.map(k => `"${k}"`).join(', ')}, "_createdDate", "_updatedDate") VALUES (${ph}, NOW(), NOW())`,
            vals
          );
          // Mantener el contador del evento (badge inscritos) como el flujo real.
          await client.query(`UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos",0) + 1, "_updatedDate" = NOW() WHERE "_id" = $1`, [e._id]);
          totalBk++;
        }
        await client.query('COMMIT');
        alumnosOk++;
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    } catch (e) { errores++; console.warn(`  ⚠️ ${c.primerNombre} ${c.primerApellido} (${c.numeroId}): ${e.message}`); }
  }
  console.log(`\n✅ Aplicado: ${totalBk} bookings creados para ${alumnosOk} alumnos${errores ? `, ${errores} con error` : ''}.`);
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
