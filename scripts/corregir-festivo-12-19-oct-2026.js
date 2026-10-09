/**
 * Corrige el calendario de los cursos MOSAICO por el feriado del Encuentro de Dos
 * Mundos 2026: el JSON de festivos lo tenía el lunes 19-oct y es el lunes 12-oct.
 *
 * Los cursos se generaron con la fecha errada, así que hoy tienen clase el 12 y
 * no el 19. La corrección NO regenera los cursos (eso borraría el cierre de sesión
 * del guía en todas sus clases pasadas): re-fecha POR POSICIÓN las clases futuras
 * afectadas. Cada clase conserva su _id, lección, guía, Zoom y agendamientos; sólo
 * cambia de día, igual que si el curso se hubiera generado con la fecha correcta.
 *
 *   Caso A (curso con clase el 12): las clases entre el 12 y el 19 pasan a las
 *     fechas correctas — en un LUN-MIÉ: 12→14 y 14→19. El resto no se mueve.
 *   Caso B (curso que empieza después del 12, p.ej. 0CTUBRE192026M): le faltaba
 *     su clase del 19 y tenía una de compensación al final. Cada clase corre al
 *     hueco anterior y la última (la compensación) pasa a ser la del 19.
 *
 * IMPULSA queda fuera: no aplica el calendario de festivos.
 * Snapshot de lo movido en PURGE_LOG (tipoPurga CORRECCION_FESTIVO) para revertir.
 *
 *   node scripts/corregir-festivo-12-19-oct-2026.js           (ensayo)
 *   node scripts/corregir-festivo-12-19-oct-2026.js --apply
 */
const { Client } = require('pg');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const TZ = 'America/Santiago';
const MAL = '2026-10-12';   // tenía clase y es feriado
const BIEN = '2026-10-19';  // es día de clase y no la tenía

function compartidoId(grupo, instante) {
  const h = crypto.createHash('md5').update(`${grupo}|${instante}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const cursos = (await c.query(`
      SELECT "_id","campaign","tipoCurso","salon","horarioCurso","grupoHorarioId","inicioCurso"::text AS inicio
      FROM "CURSOS_CAMPAIGN"
      WHERE UPPER("tipoCurso") <> 'IMPULSA' AND "horarioCurso" ~* '^LUN' AND "inicioCurso" <= $1`, [BIEN])).rows;

    const plan = [];       // { curso, moves: [{id, de, a, hora, compartido}] }
    const raros = [];
    // Todos los eventos futuros de esos cursos en UNA consulta (el filtro por día
    // va sobre "dia" sin función, para que use el índice).
    const todos = (await c.query(`
      SELECT e."_id", e."cursoCampaignId" AS curso, (e."dia" AT TIME ZONE '${TZ}')::date::text AS f,
             TO_CHAR(e."dia" AT TIME ZONE '${TZ}', 'HH24:MI') AS h,
             e."eventoCompartidoId" AS comp, e."sesionCerrada" AS cerrada
      FROM "CALENDARIO" e
      WHERE e."cursoCampaignId" = ANY($1) AND e."dia" >= ($2::timestamp AT TIME ZONE '${TZ}')
      ORDER BY e."dia"`, [cursos.map((x) => x._id), `${MAL} 00:00`])).rows;
    const porCurso = new Map();
    for (const e of todos) (porCurso.get(e.curso) || porCurso.set(e.curso, []).get(e.curso)).push(e);

    for (const cc of cursos) {
      const ev = porCurso.get(cc._id) || [];
      if (ev.length === 0) continue;
      const fechas = ev.map((e) => e.f);
      const has12 = fechas.includes(MAL), has19 = fechas.includes(BIEN);
      if (has19 && !has12) continue; // ya correcto
      if (has12 && has19) { raros.push(`${cc.campaign} ${cc.tipoCurso} ${cc.salon}: tiene clase el 12 y el 19`); continue; }

      let ventana, nuevas;
      if (has12) {
        ventana = ev.filter((e) => e.f >= MAL && e.f <= BIEN);
        nuevas = [...ventana.map((e) => e.f).filter((f) => f !== MAL), BIEN].sort();
      } else {
        ventana = ev.filter((e) => e.f >= BIEN);
        nuevas = [...ventana.map((e) => e.f), BIEN].sort().slice(0, ventana.length);
      }
      const moves = [];
      ventana.forEach((e, i) => {
        if (e.f === nuevas[i]) return;
        if (e.cerrada) raros.push(`${cc.campaign} ${cc.tipoCurso} ${cc.salon}: la clase del ${e.f} ya está cerrada`);
        moves.push({
          id: e._id, de: e.f, a: nuevas[i], hora: e.h,
          compartido: e.comp && cc.grupoHorarioId ? compartidoId(cc.grupoHorarioId, `${nuevas[i]} ${e.h}`) : e.comp,
        });
      });
      if (moves.length) plan.push({ curso: cc, caso: has12 ? 'A' : 'B', moves });
    }

    const ids = plan.flatMap((p) => p.moves.map((m) => m.id));
    const bkr = ids.length ? (await c.query(`
      SELECT COUNT(*)::int n,
             COUNT(*) FILTER (WHERE "asistio" IS TRUE OR "asistencia" IS TRUE OR "participacion" IS TRUE
                                 OR "calificacion" IS NOT NULL)::int reg
      FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = ANY($1) OR "idEvento" = ANY($1)`, [ids])).rows[0] : { n: 0, reg: 0 };
    const bk = bkr.n;
    if (bkr.reg) raros.push(`${bkr.reg} agendamiento(s) de las clases a mover ya tienen asistencia o nota`);

    for (const p of plan) {
      const resumen = p.moves.length > 3
        ? `${p.moves.length} clases corridas un hueco (${p.moves[p.moves.length - 1].de} → ${BIEN})`
        : p.moves.map((m) => `${m.de}→${m.a}`).join(', ');
      console.log(`[${p.caso}] ${p.curso.campaign} · ${p.curso.tipoCurso} · ${p.curso.salon} (${p.curso.horarioCurso}): ${resumen}`);
    }
    console.log(`\nCursos: ${plan.length} (A: ${plan.filter((p) => p.caso === 'A').length}, B: ${plan.filter((p) => p.caso === 'B').length})`);
    console.log(`Clases re-fechadas: ${ids.length} · agendamientos que se mueven con ellas: ${bk}`);
    if (raros.length) { console.log('\n⚠ Revisar:'); raros.forEach((r) => console.log('  ' + r)); }
    if (raros.length) { console.log('\nNo se aplica nada mientras haya casos a revisar.'); return; }
    if (!APPLY) { console.log('\nEnsayo: no se escribió nada. Agrega --apply.'); return; }

    await c.query('BEGIN');
    await c.query(`
      INSERT INTO "PURGE_LOG" ("_id","tipoPurga","snapshot","motivo","realizadoPor","filasBorradas","_createdDate")
      VALUES ($1,'CORRECCION_FESTIVO',$2,$3,'script:corregir-festivo-12-19-oct-2026',$4,NOW())`,
      [`plog_${Date.now()}_fest1219`,
       JSON.stringify(plan.map((p) => ({ cursoId: p.curso._id, caso: p.caso, moves: p.moves }))),
       'Encuentro de Dos Mundos 2026 es el lunes 12-oct (no el 19): clases del 12 suspendidas y reprogramadas al 19',
       JSON.stringify({ cursos: plan.length, eventos: ids.length, agendamientos: bk })]);
    for (const p of plan) for (const m of p.moves) {
      const instante = `${m.a} ${m.hora}:00`;
      await c.query(`
        UPDATE "CALENDARIO" SET "fecha" = $2::date, "dia" = ($3::timestamp AT TIME ZONE '${TZ}'),
               "eventoCompartidoId" = $4, "_updatedDate" = NOW()
        WHERE "_id" = $1`, [m.id, m.a, instante, m.compartido]);
      await c.query(`
        UPDATE "ACADEMICA_BOOKINGS" SET "fecha" = $2::date, "fechaEvento" = ($3::timestamp AT TIME ZONE '${TZ}'),
               "_updatedDate" = NOW()
        WHERE "eventoId" = $1 OR "idEvento" = $1`, [m.id, m.a, instante]);
    }
    await c.query('COMMIT');
    console.log('\n✅ Aplicado.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
