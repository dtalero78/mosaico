/**
 * MOSAICO — Carga histórica de asistencia de una campaña.
 *
 * Para campañas cuyos alumnos se cargaron a la plataforma DESPUÉS de que las
 * clases se dictaran: sus agendamientos nacieron con asistencia en "no" y el guía
 * nunca tuvo cómo marcarla. Decisión del usuario (oct-2026, JUNIO082026M): todos
 * asistieron. El script, sobre las clases del curso de campaña hasta `--hasta`:
 *
 *   1. Pasa de WELCOME a su curso real a los alumnos aprobados que sigan ahí
 *      (misma regla que `promoteFromWelcome` con `leccionDelSalon`: la lección por
 *      la que va su salón; activa salvo OnHold o contrato vencido).
 *   2. Marca asistencia (asistio + asistencia) en los agendamientos en "no".
 *      NO toca las clases donde el guía ya marcó a alguien: ahí los ausentes son
 *      reales. Tampoco las clases anteriores al contrato del alumno.
 *   3. Crea como ASISTIDOS los agendamientos que faltan (alumnos aprobados y
 *      activos, clases desde su contrato) y sube `CALENDARIO.inscritos`.
 *   4. Cierra las sesiones con `motivoCierre='CARGA_HISTORICA'` (no cuenta como
 *      rescate de Coordinación en Gestión Coordinación).
 *   5. Cierra en DEFINITIVO los informes semanales del Reporte Académico de esas
 *      clases (`cerradoMasivo`, igual que `cerrar-informes-campanas.js`).
 *
 * "Antes del contrato" usa la fecha de contrato SÓLO si es una firma real: en las
 * campañas migradas muchas fichas guardan como fecha de contrato el día de carga
 * (±1 día de _createdDate), y ahí se cuenta desde el inicio del curso (ver FREF).
 * Una clase sólo se protege por "asistencia del guía" si esa asistencia no la
 * puso una carga anterior (se excluyen los ids registrados en PURGE_LOG), así que
 * el script se puede volver a correr sobre la misma campaña.
 *
 * Nunca toca clases que aún no empiezan, aunque caigan antes de `--hasta`, salvo
 * `--incluir-futuras`. Todo va en UNA transacción. Deja el detalle (ids de
 * agendamientos marcados/creados, sesiones cerradas, alumnos promovidos) en
 * PURGE_LOG (tipoPurga='CARGA_ASISTENCIA_HISTORICA') y en un JSON local, para
 * poder revertirlo exacto.
 *
 * Uso:
 *   node scripts/carga-asistencia-historica.js --campaign=JUNIO082026M --hasta=2026-10-05
 *   node scripts/carga-asistencia-historica.js --campaign=JUNIO082026M --hasta=2026-10-05 --apply
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || null;
const APPLY = process.argv.includes('--apply');
const INCLUIR_FUTURAS = process.argv.includes('--incluir-futuras');
const CAMP = arg('campaign');
const HASTA = arg('hasta'); // YYYY-MM-DD, inclusive, hora de Chile
const ACTOR = arg('actor') || 'Script carga-asistencia-historica';
if (!CAMP || !/^\d{4}-\d{2}-\d{2}$/.test(HASTA || '')) {
  console.error('Uso: --campaign=XXX --hasta=YYYY-MM-DD [--apply] [--incluir-futuras]');
  process.exit(1);
}

const TZ = 'America/Santiago';
let seq = 0;
const bkgId = () => `bkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${(seq++).toString(36)}`;
const logId = () => `prg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
// Fecha de contrato que sirve de límite: sólo si es una FECHA REAL de firma.
// En las campañas migradas muchas fichas guardan como fechaContrato el día en
// que se cargaron (±1 día de _createdDate); ahí no hay límite y se cuenta desde
// el inicio del curso. Una fecha futura tampoco sirve. NULL = sin límite.
const FREF = (a) => `(CASE WHEN ${a}."fechaContrato" IS NULL OR ${a}."fechaContrato" > CURRENT_DATE
  OR ABS(${a}."fechaContrato" - ${a}."_createdDate"::date) <= 1 THEN NULL ELSE ${a}."fechaContrato" END)`;
const APROBADO = `LOWER(COALESCE(p."aprobacion",'')) IN ('aprobado','aprobada')`;

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false }, max: 1,
  });
  const client = await pool.connect();
  const resumen = { campaign: CAMP, hasta: HASTA, apply: APPLY };
  const detalle = { promovidos: [], marcados: [], creados: [], cerradas: [] };
  try {
    await client.query(`SET statement_timeout = '120s'`);
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);

    // Corte: fin del día --hasta en Chile; nunca más allá de ahora salvo --incluir-futuras.
    const corteRow = (await client.query(
      `SELECT (($1::date + 1)::timestamp AT TIME ZONE '${TZ}') corte, NOW() ahora`, [HASTA])).rows[0];
    const corte = INCLUIR_FUTURAS ? corteRow.corte : new Date(Math.min(+corteRow.corte, +corteRow.ahora));
    resumen.corteEfectivo = corte.toISOString();

    const futurasEnRango = (await client.query(
      `SELECT COUNT(*)::int n FROM "CALENDARIO" c JOIN "CURSOS_CAMPAIGN" cc ON cc."_id"=c."cursoCampaignId"
        WHERE cc."campaign"=$1 AND c."dia" >= NOW() AND c."dia" < $2`, [CAMP, corteRow.corte])).rows[0].n;
    resumen.clasesFuturasDentroDelCorte = futurasEnRango;
    resumen.clasesFuturasIncluidas = INCLUIR_FUTURAS;

    // Agendamientos que marcó o creó una carga anterior de esta campaña: no son
    // asistencia registrada por el guía, así que no deben "proteger" una clase.
    await client.query(`CREATE TEMP TABLE _prev ("id" text PRIMARY KEY) ON COMMIT DROP`);
    await client.query(`
      INSERT INTO _prev
      SELECT DISTINCT x FROM (
        SELECT jsonb_array_elements_text(l."snapshot"->'detalle'->'marcados') x
          FROM "PURGE_LOG" l WHERE l."tipoPurga"='CARGA_ASISTENCIA_HISTORICA' AND l."contrato"=$1
        UNION ALL
        SELECT jsonb_array_elements(l."snapshot"->'detalle'->'creados')->>'_id'
          FROM "PURGE_LOG" l WHERE l."tipoPurga"='CARGA_ASISTENCIA_HISTORICA' AND l."contrato"=$1
        UNION ALL
        SELECT jsonb_array_elements_text(r->'bookingIds')
          FROM "PURGE_LOG" l, jsonb_array_elements(l."snapshot") r
         WHERE l."tipoPurga"='APROBACION_CARGA_HISTORICA' AND l."contrato"=$1
      ) s WHERE x IS NOT NULL`, [CAMP]);
    resumen.agendamientosDeCargasAnteriores = (await client.query(`SELECT COUNT(*)::int n FROM _prev`)).rows[0].n;

    // Clases en alcance + si el guía ya marcó a alguien.
    await client.query(`
      CREATE TEMP TABLE _ev ON COMMIT DROP AS
      SELECT c."_id", c."dia", c."cursoCampaignId", c."sesionCerrada",
             EXISTS (SELECT 1 FROM "ACADEMICA_BOOKINGS" b
                      WHERE (b."eventoId"=c."_id" OR b."idEvento"=c."_id")
                        AND (b."asistio" IS TRUE OR b."asistencia" IS TRUE)
                        AND NOT EXISTS (SELECT 1 FROM _prev WHERE _prev."id"=b."_id")) AS "conAsistReal"
        FROM "CALENDARIO" c JOIN "CURSOS_CAMPAIGN" cc ON cc."_id"=c."cursoCampaignId"
       WHERE cc."campaign"=$1 AND c."dia" < $2`, [CAMP, corte]);
    await client.query(`CREATE INDEX ON _ev ("_id")`);
    await client.query(`ANALYZE _ev`);
    const ev = (await client.query(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE "conAsistReal")::int con_asist_real,
              COUNT(*) FILTER (WHERE "sesionCerrada" IS TRUE)::int ya_cerradas FROM _ev`)).rows[0];
    resumen.clases = ev;

    console.log('⏱ welcome', new Date().toISOString().slice(11,19));
    // ── 1. WELCOME → curso real ───────────────────────────────────────────────
    const wel = (await client.query(`
      SELECT a."_id" aid, a."userLogin", a."numeroId", a."curso", a."nivel" anivel, a."step" astep,
             a."cambioStepHistory",
             p."_id" pid, p."campaign", p."tipoCurso", p."horarioCurso", p."salon", p."nivel", p."step",
             p."primerNombre", p."primerApellido", p."fechaOnHold",
             (CURRENT_DATE >= p."finalContrato" + 2) AS vencido, ${APROBADO} AS aprobado,
             cc."_id" ccid
        FROM "PEOPLE" p
        JOIN "ACADEMICA" a ON a."numeroId"=p."numeroId" AND UPPER(TRIM(a."curso"))='WELCOME'
        LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso"
       WHERE p."tipoUsuario"='BENEFICIARIO' AND p."campaign"=$1
         AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`, [CAMP])).rows;
    resumen.welcome = { encontrados: wel.length, promovidos: 0, omitidos: [] };
    for (const w of wel) {
      const nombre = `${w.primerNombre || ''} ${w.primerApellido || ''}`.trim();
      if (!w.aprobado) { resumen.welcome.omitidos.push({ nombre, motivo: 'contrato sin aprobar' }); continue; }
      if (!w.ccid) { resumen.welcome.omitidos.push({ nombre, motivo: 'sin curso de campaña' }); continue; }
      // Lección por la que va el salón (leccionActualCurso).
      const l = (await client.query(
        `(SELECT "sesionModulo" m,"sesionLeccion" l, 1 o FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 AND "dia">=NOW() AND "sesionLeccion" IS NOT NULL ORDER BY "dia" ASC LIMIT 1)
         UNION ALL
         (SELECT "sesionModulo","sesionLeccion", 2 FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 AND "sesionLeccion" IS NOT NULL ORDER BY "dia" DESC LIMIT 1)
         ORDER BY o LIMIT 1`, [w.ccid])).rows[0];
      const destNivel = l?.m || w.nivel || '';
      const destStep = l?.l || w.step || '';
      const activar = !w.fechaOnHold && !w.vencido;
      const entry = {
        fecha: new Date().toISOString(), accion: 'PROMOCION_WELCOME',
        de: `${w.curso || '—'} / ${w.anivel || '—'} / ${w.astep || '—'}`,
        a: `${w.tipoCurso || '—'} / ${destNivel || '—'} / ${destStep || '—'}`,
        realizadoPor: ACTOR, motivo: `Carga histórica de asistencia ${CAMP}`,
      };
      const hist = Array.isArray(w.cambioStepHistory) ? w.cambioStepHistory : [];
      await client.query(`UPDATE "PEOPLE" SET "nivel"=$2,"step"=$3,"_updatedDate"=NOW() WHERE "_id"=$1`, [w.pid, destNivel, destStep]);
      await client.query(
        `UPDATE "ACADEMICA" SET "campaign"=$2,"curso"=$3,"salon"=$4,"nivel"=$5,"step"=$6,
                "cambioStepHistory"=$7::jsonb ${activar ? ',"estadoInactivo"=false' : ''},"_updatedDate"=NOW()
          WHERE "_id"=$1`,
        [w.aid, w.campaign, w.tipoCurso, w.salon, destNivel, destStep, JSON.stringify([...hist, entry])]);
      if (activar) {
        await client.query(
          `UPDATE "USUARIOS_ROLES" SET "activo"=true,"_updatedDate"=NOW()
            WHERE ($1 <> '' AND "userLogin"=$1)
               OR ($1 = '' AND UPPER(TRIM("numberid"))=UPPER(TRIM($2)) AND "rol"='ESTUDIANTE')`,
          [String(w.userLogin || '').trim(), String(w.numeroId || '').trim()]);
      }
      resumen.welcome.promovidos++;
      detalle.promovidos.push({ academicaId: w.aid, nombre, antes: entry.de, despues: entry.a, activado: activar });
    }

    console.log('⏱ marcar', new Date().toISOString().slice(11,19));
    // ── 2. Marcar asistencia en agendamientos existentes ──────────────────────
    const marc = (await client.query(`
      WITH cand AS (
        SELECT b."_id", e."conAsistReal",
               (e."dia" AT TIME ZONE '${TZ}')::date < ${FREF("p")} AS antes_contrato,
               (${APROBADO}) AS aprobado, p."_id" IS NULL AS sin_people
          FROM _ev e
          JOIN "ACADEMICA_BOOKINGS" b ON (b."eventoId"=e."_id" OR b."idEvento"=e."_id")
          LEFT JOIN "ACADEMICA" a ON a."_id" IN (b."idEstudiante", b."studentId")
          LEFT JOIN LATERAL (SELECT * FROM "PEOPLE" pp WHERE pp."numeroId"=a."numeroId" AND pp."tipoUsuario"='BENEFICIARIO'
                              ORDER BY pp."_createdDate" DESC NULLS LAST LIMIT 1) p ON true
         WHERE b."cancelo" IS NOT TRUE AND b."asistio" IS NOT TRUE AND b."asistencia" IS NOT TRUE)
      SELECT * FROM cand`)).rows;
    const aMarcar = marc.filter((r) => !r.conAsistReal && !r.antes_contrato && r.aprobado && !r.sin_people).map((r) => r._id);
    resumen.marcar = {
      enNo: marc.length,
      marcados: aMarcar.length,
      omitidos_clase_con_asistencia_del_guia: marc.filter((r) => r.conAsistReal).length,
      omitidos_antes_del_contrato: marc.filter((r) => !r.conAsistReal && r.antes_contrato).length,
      omitidos_contrato_sin_aprobar: marc.filter((r) => !r.conAsistReal && !r.antes_contrato && !r.aprobado && !r.sin_people).length,
      omitidos_sin_ficha: marc.filter((r) => !r.conAsistReal && r.sin_people).length,
    };
    if (aMarcar.length) {
      await client.query(
        `UPDATE "ACADEMICA_BOOKINGS" SET "asistio"=true,"asistencia"=true,"_updatedDate"=NOW() WHERE "_id" = ANY($1::text[])`,
        [aMarcar]);
    }
    detalle.marcados = aMarcar;

    console.log('⏱ crear', new Date().toISOString().slice(11,19));
    // ── 3. Crear como asistidos los agendamientos que faltan ──────────────────
    const falt = (await client.query(`
      WITH ben AS (
        SELECT p."numeroId", p."primerNombre", p."primerApellido", p."celular", p."plataforma",
               ${FREF("p")} fcon, cc."_id" ccid, p."tipoCurso"
          FROM "PEOPLE" p
          JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso"
         WHERE p."tipoUsuario"='BENEFICIARIO' AND p."campaign"=$1 AND ${APROBADO} AND p."estadoInactivo" IS NOT TRUE
           AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'),
      aca AS (
        SELECT DISTINCT ON (a."numeroId") a."_id" aid, a."numeroId"
          FROM "ACADEMICA" a JOIN ben ON ben."numeroId"=a."numeroId"
         ORDER BY a."numeroId", (UPPER(a."curso")=UPPER(ben."tipoCurso")) DESC, a."_createdDate" DESC NULLS LAST),
      todos AS (SELECT a2."_id" aid, a2."numeroId" FROM "ACADEMICA" a2 WHERE a2."numeroId" IN (SELECT "numeroId" FROM ben))
      SELECT aca.aid, ben.*, c."_id" eid, c."advisor", c."dia", c."hora", c."tipo", c."evento", c."nivel", c."step",
             c."tituloONivel", c."nombreEvento", c."titulo", c."linkZoom",
             (c."dia" AT TIME ZONE '${TZ}')::date < ben.fcon AS antes_contrato
        FROM ben JOIN aca ON aca."numeroId"=ben."numeroId"
        JOIN _ev e ON e."cursoCampaignId"=ben.ccid
        JOIN "CALENDARIO" c ON c."_id"=e."_id"
       WHERE NOT EXISTS (SELECT 1 FROM "ACADEMICA_BOOKINGS" b JOIN todos ON todos.aid IN (b."idEstudiante", b."studentId")
                          WHERE todos."numeroId"=ben."numeroId" AND (b."eventoId"=c."_id" OR b."idEvento"=c."_id"))`, [CAMP])).rows;
    const aCrear = falt.filter((r) => !r.antes_contrato);
    resumen.crear = {
      faltantes: falt.length,
      creados: aCrear.length,
      alumnos: new Set(aCrear.map((r) => r.numeroId)).size,
      omitidos_antes_del_contrato: falt.length - aCrear.length,
    };
    const ahoraIso = new Date().toISOString();
    for (let i = 0; i < aCrear.length; i += 200) {
      const lote = aCrear.slice(i, i + 200);
      const cols = ['_id', 'eventoId', 'idEvento', 'studentId', 'idEstudiante', 'primerNombre', 'primerApellido',
        'numeroId', 'celular', 'plataforma', 'nivel', 'step', 'advisor', 'fecha', 'fechaEvento', 'hora', 'tipo',
        'tipoEvento', 'linkZoom', 'nombreEvento', 'tituloONivel', 'asistio', 'asistencia', 'participacion',
        'noAprobo', 'cancelo', 'agendadoPor', 'fechaAgendamiento', 'origen'];
      const params = [];
      const values = lote.map((r) => {
        const id = bkgId();
        detalle.creados.push({ _id: id, eventoId: r.eid });
        const row = [id, r.eid, r.eid, r.aid, r.aid, r.primerNombre || null, r.primerApellido || null,
          r.numeroId || null, r.celular || null, r.plataforma || null,
          r.nivel || r.tituloONivel || null, r.step || r.nombreEvento || null, r.advisor || '',
          r.dia, r.dia, r.hora || null, r.tipo || r.evento || null, r.tipo || r.evento || null,
          r.linkZoom || null, r.nombreEvento || r.titulo || null, r.tituloONivel || null,
          true, true, false, false, false, `Carga histórica asistencia (${CAMP})`, ahoraIso, 'POSTGRES'];
        const base = params.length;
        params.push(...row);
        return `(${row.map((_, k) => `$${base + k + 1}`).join(',')}, NOW(), NOW())`;
      });
      await client.query(
        `INSERT INTO "ACADEMICA_BOOKINGS" (${cols.map((c) => `"${c}"`).join(',')}, "_createdDate", "_updatedDate")
         VALUES ${values.join(',')}`, params);
    }
    if (aCrear.length) {
      const porEvento = {};
      for (const r of aCrear) porEvento[r.eid] = (porEvento[r.eid] || 0) + 1;
      await client.query(
        `UPDATE "CALENDARIO" c SET "inscritos"=COALESCE(c."inscritos",0)+x.n
           FROM (SELECT UNNEST($1::text[]) id, UNNEST($2::int[]) n) x WHERE c."_id"=x.id`,
        [Object.keys(porEvento), Object.values(porEvento)]);
    }

    console.log('⏱ cerrar', new Date().toISOString().slice(11,19));
    // ── 4. Cerrar las sesiones ────────────────────────────────────────────────
    const cerr = (await client.query(
      `UPDATE "CALENDARIO" c SET "sesionCerrada"=true, "fechaCierreSesion"=NOW(), "motivoCierre"='CARGA_HISTORICA',
              "notasadvisor"=COALESCE(NULLIF(c."notasadvisor",''), 'Carga histórica de asistencia (alumnos cargados después de la clase).'),
              "_updatedDate"=NOW()
         FROM _ev e WHERE c."_id"=e."_id" AND c."sesionCerrada" IS NOT TRUE
       RETURNING c."_id"`)).rows.map((r) => r._id);
    resumen.cerradas = cerr.length;
    detalle.cerradas = cerr;

    // ── 5. Cerrar los informes del Reporte Académico ──────────────────────────
    // Mismo universo y misma escritura que `cerrar-informes-campanas.js`: cada
    // (curso, salón, semana) con clase en alcance que no esté cerrado pasa a
    // DEFINITIVO con `cerradoMasivo` (no se le carga al guía en Gestión
    // Coordinación). Las valoraciones ya escritas no se tocan.
    const inf = (await client.query(`
      WITH semanas AS (
        SELECT cc."campaign", cc."tipoCurso" AS curso, cc."salon", (date_trunc('week', e."dia")::date) AS "semanaInicio"
          FROM _ev e JOIN "CURSOS_CAMPAIGN" cc ON cc."_id"=e."cursoCampaignId"
         WHERE UPPER(COALESCE(cc."tipoCurso",'')) <> 'IMPULSA'
         GROUP BY 1,2,3,4)
      INSERT INTO "REPORTE_ACADEMICO_CIERRE"
        ("_id","curso","salon","campaign","semanaInicio","estado","cerradoAdminPor","cerradoAdminEn","cerradoMasivo")
      SELECT 'rac_' || gen_random_uuid(), s.curso, s."salon", s."campaign", s."semanaInicio", 'DEFINITIVO', $1, NOW(), true
        FROM semanas s
       WHERE NOT EXISTS (SELECT 1 FROM "REPORTE_ACADEMICO_CIERRE" ci
                          WHERE ci."curso"=s.curso AND ci."salon"=s."salon" AND ci."campaign"=s."campaign"
                            AND ci."semanaInicio"=s."semanaInicio")
      RETURNING "_id", "semanaInicio"::text`, [ACTOR])).rows;
    resumen.informesCerrados = inf.length;
    detalle.informes = inf.map((r) => r._id);

    // Estado resultante de las clases en alcance
    resumen.despues = (await client.query(`
      SELECT COUNT(b."_id")::int agendamientos,
             COUNT(b."_id") FILTER (WHERE b."asistio" IS TRUE OR b."asistencia" IS TRUE)::int asistieron,
             COUNT(b."_id") FILTER (WHERE b."asistio" IS NOT TRUE AND b."asistencia" IS NOT TRUE AND b."cancelo" IS NOT TRUE)::int ausentes
        FROM _ev e JOIN "ACADEMICA_BOOKINGS" b ON (b."eventoId"=e."_id" OR b."idEvento"=e."_id")`)).rows[0];

    if (APPLY) {
      await client.query(
        `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","snapshot","motivo","realizadoPor","filasBorradas")
         VALUES ($1,'CARGA_ASISTENCIA_HISTORICA',$2,$3::jsonb,$4,$5,$6::jsonb)`,
        [logId(), CAMP, JSON.stringify({ resumen, detalle }),
         `Carga histórica de asistencia de ${CAMP} hasta ${HASTA}: todos asistieron (decisión del usuario, oct-2026).`,
         ACTOR,
         JSON.stringify({ marcados: aMarcar.length, creados: aCrear.length, cerradas: cerr.length, promovidos: detalle.promovidos.length, informes: inf.length })]);
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    // .mosaico-tmp/ está en .gitignore: el detalle lleva nombres de alumnos.
    const dir = process.env.CARGA_OUT_DIR || path.join(process.cwd(), '.mosaico-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir,`carga-asistencia-${CAMP}-${APPLY ? 'aplicado' : 'ensayo'}-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify({ resumen, detalle }, null, 2));
    console.log(APPLY ? '✅ APLICADO' : '🧪 ENSAYO (nada se escribió)');
    console.log(JSON.stringify(resumen, null, 2));
    console.log('Detalle:', out);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
