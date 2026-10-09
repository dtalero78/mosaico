/**
 * Corrige las clases FUTURAS de los cursos MOSAICO afectadas por la corrección de
 * feriados de Chile (f1bc09f). Generaliza scripts/corregir-festivo-12-19-oct-2026.js.
 *
 * Fechas que cambian: las que la regla ANTERIOR (JSON viejo, tomado de git) y la
 * NUEVA (src/lib/festivos-chile.ts, cargada tal cual) clasifican distinto. Sólo esas:
 * un hueco hecho a mano en otra fecha no se toca.
 *
 * Por curso (IMPULSA fuera: no aplica festivos), sobre sus clases posteriores a hoy:
 *   - quita las que caen en un día que AHORA es feriado;
 *   - agrega los días que DEJARON de ser feriado y son de su horario, entre su
 *     inicio (o mañana) y su última clase;
 *   - mantiene el número de clases: si sobran se quita la última (compensación),
 *     si faltan se agrega el siguiente día de clase válido tras la última.
 * Luego re-fecha POR POSICIÓN: cada clase conserva _id, lección, guía, Zoom y
 * agendamientos (mismo método que el 12/19-oct). No regenera cursos.
 *
 *   node scripts/corregir-feriados-cruzados.js           (ensayo)
 *   node scripts/corregir-feriados-cruzados.js --apply
 */
const path = require('path');
const Module = require('module');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

// Cargar los .ts de src/lib con el alias "@/"
require('sucrase/register/ts');
const SRC = path.join(__dirname, '..', 'src');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(SRC, req.slice(2));
  return origResolve.call(this, req, ...rest);
};
const { esFestivoChile, feriadosFijosChile } = require(path.join(SRC, 'lib/festivos-chile.ts'));
const { parseHorario } = require(path.join(SRC, 'lib/cursos-campaign.ts'));

const APPLY = process.argv.includes('--apply');
const TZ = 'America/Santiago';

// ── Regla ANTERIOR: fijos + Semana Santa (sin traslados) + JSON viejo ─────────
const oldJson = JSON.parse(execSync('git show f1bc09f~1:src/data/festivos.json', { cwd: path.join(__dirname, '..') }).toString());
// La regla vieja calculaba sólo los fijos y Semana Santa (los únicos en mar/abr).
const FIJOS_VIEJOS = ['01-01', '05-01', '05-21', '07-16', '08-15', '09-18', '09-19', '11-01', '12-08', '12-25'];
function esFestivoViejo(d) {
  const md = d.slice(5), mes = d.slice(5, 7);
  const semanaSanta = (mes === '03' || mes === '04') && feriadosFijosChile(Number(d.slice(0, 4))).has(d);
  return FIJOS_VIEJOS.includes(md) || semanaSanta || (oldJson[d] || []).some((x) => x.c === 'CL');
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
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
    const hoy = (await c.query(`SELECT (NOW() AT TIME ZONE '${TZ}')::date::text AS d`)).rows[0].d;

    // Fechas que cambiaron de clasificación, de mañana a fin de 2029
    const ahoraFeriado = new Set(), yaNoFeriado = new Set();
    for (let d = addDays(hoy, 1); d <= '2029-12-31'; d = addDays(d, 1)) {
      const viejo = esFestivoViejo(d), nuevo = esFestivoChile(d);
      if (nuevo && !viejo) ahoraFeriado.add(d);
      if (viejo && !nuevo) yaNoFeriado.add(d);
    }
    console.log('Ahora feriado:', [...ahoraFeriado].join(', ') || '—');
    console.log('Dejó de ser feriado:', [...yaNoFeriado].join(', ') || '—');

    const personalizados = new Set((await c.query(`SELECT "fecha"::text f FROM "FESTIVOS_PERSONALIZADOS"`)).rows.map((r) => r.f));
    const susp = new Map();
    for (const r of (await c.query(`SELECT "cursoCampaignId" id, "fecha"::text f FROM "CURSOS_SUSPENSIONES"`)).rows)
      (susp.get(r.id) || susp.set(r.id, new Set()).get(r.id)).add(r.f);

    const cursos = (await c.query(`
      SELECT "_id","campaign","tipoCurso","salon","horarioCurso","grupoHorarioId",
             "inicioCurso"::text AS inicio, "cierreCurso"::text AS cierre
      FROM "CURSOS_CAMPAIGN" WHERE UPPER("tipoCurso") <> 'IMPULSA'`)).rows;
    const todos = (await c.query(`
      SELECT e."_id", e."cursoCampaignId" AS curso, (e."dia" AT TIME ZONE '${TZ}')::date::text AS f,
             TO_CHAR(e."dia" AT TIME ZONE '${TZ}', 'HH24:MI') AS h,
             e."eventoCompartidoId" AS comp, e."sesionCerrada" AS cerrada
      FROM "CALENDARIO" e
      WHERE e."cursoCampaignId" = ANY($1) AND e."dia" >= ($2::timestamp AT TIME ZONE '${TZ}')
      ORDER BY e."dia"`, [cursos.map((x) => x._id), `${addDays(hoy, 1)} 00:00`])).rows;
    const porCurso = new Map();
    for (const e of todos) (porCurso.get(e.curso) || porCurso.set(e.curso, []).get(e.curso)).push(e);

    const plan = [], raros = [];
    for (const cc of cursos) {
      const ev = porCurso.get(cc._id) || [];
      if (!ev.length) continue;
      const nombre = `${cc.campaign} · ${cc.tipoCurso} · ${cc.salon} (${cc.horarioCurso})`;
      const dias = parseHorario(cc.horarioCurso)?.dias || [...new Set(ev.map((e) => dow(e.f)))];
      const suspC = susp.get(cc._id) || new Set();
      const noClase = (d) => esFestivoChile(d) || personalizados.has(d) || suspC.has(d);
      const D = ev.map((e) => e.f);
      const desde = cc.inicio && cc.inicio > hoy ? cc.inicio : addDays(hoy, 1);
      const ultima = D[D.length - 1];

      const quitar = D.filter((d) => ahoraFeriado.has(d));
      const agregar = [...yaNoFeriado].filter((d) => d >= desde && d <= ultima && dias.includes(dow(d)) && !noClase(d) && !D.includes(d));
      if (!quitar.length && !agregar.length) continue;

      let nuevas = [...D.filter((d) => !quitar.includes(d)), ...agregar].sort();
      while (nuevas.length > D.length) nuevas.pop();
      let d = nuevas[nuevas.length - 1];
      while (nuevas.length < D.length) {
        d = addDays(d, 1);
        if (dias.includes(dow(d)) && !noClase(d)) nuevas.push(d);
      }
      if (cc.cierre && nuevas[nuevas.length - 1] > cc.cierre) { raros.push(`${nombre}: pasaría su cierre (${cc.cierre})`); continue; }

      const moves = [];
      ev.forEach((e, i) => {
        if (e.f === nuevas[i]) return;
        if (e.cerrada) raros.push(`${nombre}: la clase del ${e.f} ya está cerrada`);
        moves.push({
          id: e._id, de: e.f, a: nuevas[i], hora: e.h,
          compartido: e.comp && cc.grupoHorarioId ? compartidoId(cc.grupoHorarioId, `${nuevas[i]} ${e.h}`) : e.comp,
        });
      });
      if (moves.length) plan.push({ curso: cc, nombre, quitar, agregar, moves });
    }

    const ids = plan.flatMap((p) => p.moves.map((m) => m.id));
    const bkr = ids.length ? (await c.query(`
      SELECT COUNT(*)::int n,
             COUNT(*) FILTER (WHERE "asistio" IS TRUE OR "asistencia" IS TRUE OR "participacion" IS TRUE
                                 OR "calificacion" IS NOT NULL)::int reg
      FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = ANY($1) OR "idEvento" = ANY($1)`, [ids])).rows[0] : { n: 0, reg: 0 };
    if (bkr.reg) raros.push(`${bkr.reg} agendamiento(s) de las clases a mover ya tienen asistencia o nota`);

    const resumen = new Map();
    for (const p of plan) {
      const k = `quita [${p.quitar.join(', ')}] · agrega [${p.agregar.join(', ')}]`;
      (resumen.get(k) || resumen.set(k, []).get(k)).push(p);
    }
    for (const [k, ps] of resumen) {
      const movs = ps.reduce((s, p) => s + p.moves.length, 0);
      console.log(`\n${k} → ${ps.length} curso(s), ${movs} clases re-fechadas`);
      ps.forEach((p) => console.log(`   ${p.nombre}: ${p.moves.length} clases, última ${p.moves[p.moves.length - 1].de}→${p.moves[p.moves.length - 1].a}`));
    }
    console.log(`\nTotal: ${plan.length} cursos · ${ids.length} clases · ${bkr.n} agendamientos se mueven con ellas`);
    if (raros.length) { console.log('\n⚠ Revisar:'); raros.forEach((r) => console.log('  ' + r)); console.log('\nNo se aplica nada.'); return; }
    if (!APPLY) { console.log('\nEnsayo: no se escribió nada. Agrega --apply.'); return; }

    await c.query('BEGIN');
    await c.query(`
      INSERT INTO "PURGE_LOG" ("_id","tipoPurga","snapshot","motivo","realizadoPor","filasBorradas","_createdDate")
      VALUES ($1,'CORRECCION_FESTIVO',$2,$3,'script:corregir-feriados-cruzados',$4,NOW())`,
      [`plog_${Date.now()}_ferfix`,
       JSON.stringify(plan.map((p) => ({ cursoId: p.curso._id, quitar: p.quitar, agregar: p.agregar, moves: p.moves }))),
       'Corrección de feriados de Chile (f1bc09f): clases re-fechadas por posición',
       JSON.stringify({ cursos: plan.length, eventos: ids.length, agendamientos: bkr.n })]);
    // Dos sentencias en bloque (unnest) en vez de una por clase: la transacción dura segundos.
    const all = plan.flatMap((p) => p.moves);
    const mIds = all.map((m) => m.id), mFechas = all.map((m) => m.a);
    const mInst = all.map((m) => `${m.a} ${m.hora}:00`), mComp = all.map((m) => m.compartido);
    await c.query(`
      UPDATE "CALENDARIO" e SET "fecha" = v.f::date, "dia" = (v.i::timestamp AT TIME ZONE '${TZ}'),
             "eventoCompartidoId" = v.comp::uuid, "_updatedDate" = NOW()
      FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS v(id, f, i, comp)
      WHERE e."_id" = v.id`, [mIds, mFechas, mInst, mComp]);
    for (const col of ['eventoId', 'idEvento']) {
      await c.query(`
        UPDATE "ACADEMICA_BOOKINGS" b SET "fecha" = v.f::date, "fechaEvento" = (v.i::timestamp AT TIME ZONE '${TZ}'),
               "_updatedDate" = NOW()
        FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, f, i)
        WHERE b."${col}" = v.id`, [mIds, mFechas, mInst]);
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
