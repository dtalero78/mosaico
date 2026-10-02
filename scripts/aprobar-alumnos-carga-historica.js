/**
 * MOSAICO — Aprueba a los alumnos que quedaron SIN aprobar dentro de un contrato
 * ya aprobado, en una campaña cuya asistencia se cargó con
 * `carga-asistencia-historica.js`.
 *
 * Caso (oct-2026, JUNIO082026M): 10 alumnos con el contrato aprobado, firmado y
 * listo, pero ellos mismos sin aprobar y todavía en WELCOME. El botón "Aprobar"
 * de /person no sirve aquí: agenda TODAS las clases del curso (las de junio a
 * septiembre quedarían como ausencias), manda el WhatsApp de bienvenida y deja
 * al alumno en WELCOME. Este script hace lo mismo que la pestaña Migración:
 *
 *   1. Aprueba al alumno (mismos campos que `approveOnePerson` para un
 *      beneficiario: aprobacion, estado ACTIVA, activo, cupo confirmado,
 *      inicioContrato del titular). SIN WhatsApp.
 *   2. Lo pasa de WELCOME a la lección por la que va su salón y lo activa
 *      (ACADEMICA + login), salvo OnHold o contrato vencido.
 *   3. Agenda sus clases: las ya dictadas desde su contrato, como ASISTIDAS
 *      (igual que la carga histórica de su campaña); las futuras, normales.
 *
 * Sólo toma alumnos cuyo titular esté Aprobado y con el contrato listo. Una
 * transacción; deja el detalle en PURGE_LOG (tipoPurga='APROBACION_CARGA_HISTORICA')
 * y en .mosaico-tmp/. Ensayo por defecto.
 *
 *   node scripts/aprobar-alumnos-carga-historica.js --campaign=JUNIO082026M
 *   node scripts/aprobar-alumnos-carga-historica.js --campaign=JUNIO082026M --apply
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || null;
const APPLY = process.argv.includes('--apply');
const CAMP = arg('campaign');
const ACTOR = arg('actor') || 'Script aprobar-alumnos-carga-historica';
if (!CAMP) { console.error('Uso: --campaign=XXX [--apply]'); process.exit(1); }

const TZ = 'America/Santiago';
let seq = 0;
const bkgId = () => `bkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${(seq++).toString(36)}`;
const LIBERAN = `('devuelto','rechazado','retractado','contrato nulo')`;
const OCUPA = (a) => `((${a}."cupoConfirmado" IS TRUE OR ${a}."cupoReservadoHasta" > NOW())
  AND ${a}."fechaOnHold" IS NULL AND ${a}."cupoLiberado" IS NOT TRUE
  AND NOT (${a}."estadoInactivo" IS TRUE AND COALESCE(${a}."suspenddata"->>'accion','')='INACTIVACION')
  AND NOT EXISTS (SELECT 1 FROM "PEOPLE" tc WHERE tc."contrato"=${a}."contrato" AND tc."tipoUsuario"='TITULAR'
                   AND LOWER(TRIM(COALESCE(tc."aprobacion",''))) IN ${LIBERAN}))`;

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false }, max: 1,
  });
  const client = await pool.connect();
  const resultados = [];
  try {
    await client.query(`SET statement_timeout = '120s'`);
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);

    const alumnos = (await client.query(`
      SELECT p.*, a."_id" aid, a."userLogin" alogin, a."curso" acurso, a."nivel" anivel, a."step" astep,
             a."cambioStepHistory" ahist,
             t."aprobacion" taprob, t."gestionContratoListo" tlisto, t."inicioContrato" tinicio,
             (CURRENT_DATE >= p."finalContrato" + 2) vencido,
             (CASE WHEN p."fechaContrato" IS NULL OR p."fechaContrato" > CURRENT_DATE
                     OR ABS(p."fechaContrato" - p."_createdDate"::date) <= 1 THEN NULL ELSE p."fechaContrato" END) fref,
             cc."_id" ccid, cc."numeroUsuarios" cupos,
             (SELECT COUNT(*)::int FROM "PEOPLE" o WHERE o."tipoUsuario"='BENEFICIARIO' AND o."campaign"=p."campaign"
                AND o."tipoCurso"=p."tipoCurso" AND o."horarioCurso"=p."horarioCurso" AND ${OCUPA('o')}) ocupados,
             ${OCUPA('p')} AS ya_ocupa
        FROM "PEOPLE" p
        JOIN "ACADEMICA" a ON a."numeroId"=p."numeroId" AND UPPER(TRIM(a."curso"))='WELCOME'
        LEFT JOIN LATERAL (SELECT * FROM "PEOPLE" tt WHERE tt."contrato"=p."contrato" AND tt."tipoUsuario"='TITULAR' LIMIT 1) t ON true
        LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso"
       WHERE p."tipoUsuario"='BENEFICIARIO' AND p."campaign"=$1
         AND LOWER(COALESCE(p."aprobacion",'')) NOT IN ('aprobado','aprobada')
         AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
       ORDER BY p."tipoCurso", p."primerApellido"`, [CAMP])).rows;

    for (const s of alumnos) {
      const nombre = `${s.primerNombre || ''} ${s.primerApellido || ''}`.replace(/\s+/g, ' ').trim();
      const r = { nombre, numeroId: s.numeroId, contrato: s.contrato, curso: `${s.tipoCurso} · ${s.horarioCurso} · Salón ${s.salon || '—'}` };
      resultados.push(r);
      const motivo =
        String(s.taprob || '').toLowerCase() !== 'aprobado' ? 'el contrato no está aprobado'
        : s.tlisto !== true ? 'el contrato no está listo (sin cupo tomado)'
        : s.cupoLiberado ? 'tiene el cupo liberado'
        : !s.ccid ? 'su curso no existe en la campaña'
        : null;
      if (motivo) { r.omitido = motivo; continue; }
      r.cupo = `${s.ocupados + (s.ya_ocupa ? 0 : 1)}/${s.cupos}${s.ya_ocupa ? '' : ' (+1)'}`;
      if (!s.ya_ocupa && s.cupos > 0 && s.ocupados + 1 > s.cupos) r.sobrecupo = true;

      // 1. Aprobar (igual que approveOnePerson para BENEFICIARIO)
      await client.query(
        `UPDATE "PEOPLE" SET "aprobacion"='Aprobado', "estado"='ACTIVA', "estadoInactivo"=false,
                "inicioContrato"=COALESCE($2::date, "inicioContrato"),
                "cupoConfirmado"=CASE WHEN "tipoCurso" IS NOT NULL AND "horarioCurso" IS NOT NULL AND "cupoLiberado" IS NOT TRUE THEN true ELSE "cupoConfirmado" END,
                "cupoConfirmadoPor"=CASE WHEN "cupoConfirmado" IS NOT TRUE AND "tipoCurso" IS NOT NULL AND "horarioCurso" IS NOT NULL AND "cupoLiberado" IS NOT TRUE THEN 'aprobación' ELSE "cupoConfirmadoPor" END,
                "cupoConfirmadoEn"=CASE WHEN "cupoConfirmado" IS NOT TRUE AND "tipoCurso" IS NOT NULL AND "horarioCurso" IS NOT NULL AND "cupoLiberado" IS NOT TRUE THEN NOW() ELSE "cupoConfirmadoEn" END,
                "cupoReservadoHasta"=NULL, "_updatedDate"=NOW()
          WHERE "_id"=$1`, [s._id, s.tinicio || null]);

      // 2. WELCOME → lección por la que va su salón (leccionActualCurso) + activar
      const l = (await client.query(
        `(SELECT "sesionModulo" m,"sesionLeccion" l, 1 o FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 AND "dia">=NOW() AND "sesionLeccion" IS NOT NULL ORDER BY "dia" ASC LIMIT 1)
         UNION ALL
         (SELECT "sesionModulo","sesionLeccion", 2 FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 AND "sesionLeccion" IS NOT NULL ORDER BY "dia" DESC LIMIT 1)
         ORDER BY o LIMIT 1`, [s.ccid])).rows[0];
      const destNivel = l?.m || s.nivel || '';
      const destStep = l?.l || s.step || '';
      const activar = !s.fechaOnHold && !s.vencido;
      const entry = {
        fecha: new Date().toISOString(), accion: 'PROMOCION_WELCOME',
        de: `${s.acurso || '—'} / ${s.anivel || '—'} / ${s.astep || '—'}`,
        a: `${s.tipoCurso || '—'} / ${destNivel || '—'} / ${destStep || '—'}`,
        realizadoPor: ACTOR, motivo: `Aprobación tras carga histórica de asistencia ${CAMP}`,
      };
      const hist = Array.isArray(s.ahist) ? s.ahist : [];
      await client.query(`UPDATE "PEOPLE" SET "nivel"=$2,"step"=$3 WHERE "_id"=$1`, [s._id, destNivel, destStep]);
      await client.query(
        `UPDATE "ACADEMICA" SET "campaign"=$2,"curso"=$3,"salon"=$4,"nivel"=$5,"step"=$6,"cambioStepHistory"=$7::jsonb,
                "contrato"=COALESCE("contrato",$8) ${activar ? ',"estadoInactivo"=false' : ''},"_updatedDate"=NOW()
          WHERE "_id"=$1`,
        [s.aid, s.campaign, s.tipoCurso, s.salon, destNivel, destStep, JSON.stringify([...hist, entry]), s.contrato]);
      let login = 0;
      if (activar) {
        login = (await client.query(
          `UPDATE "USUARIOS_ROLES" SET "activo"=true,"_updatedDate"=NOW()
            WHERE ($1 <> '' AND "userLogin"=$1)
               OR ($1 = '' AND UPPER(TRIM("numberid"))=UPPER(TRIM($2)) AND "rol"='ESTUDIANTE')`,
          [String(s.alogin || '').trim(), String(s.numeroId || '').trim()])).rowCount;
      }
      r.leccion = `${destNivel} · ${destStep}`;
      r.activado = activar;
      r.cuentaLogin = login > 0 ? 'activada' : 'SIN CUENTA DE LOGIN';

      // 3. Agendamientos: pasadas desde el contrato = asistidas; futuras = normales.
      const evs = (await client.query(`
        SELECT c.*, (c."dia" < NOW()) pasada,
               (c."dia" AT TIME ZONE '${TZ}')::date < $3::date antes_contrato
          FROM "CALENDARIO" c
         WHERE c."cursoCampaignId"=$1
           AND NOT EXISTS (SELECT 1 FROM "ACADEMICA_BOOKINGS" b
                            JOIN "ACADEMICA" a2 ON a2."_id" IN (b."idEstudiante", b."studentId") AND a2."numeroId"=$2
                           WHERE b."eventoId"=c."_id" OR b."idEvento"=c."_id")`,
        [s.ccid, s.numeroId, s.fref])).rows.filter((e) => !(e.pasada && e.antes_contrato));
      const cols = ['_id', 'eventoId', 'idEvento', 'studentId', 'idEstudiante', 'primerNombre', 'primerApellido',
        'numeroId', 'celular', 'plataforma', 'nivel', 'step', 'advisor', 'fecha', 'fechaEvento', 'hora', 'tipo',
        'tipoEvento', 'linkZoom', 'nombreEvento', 'tituloONivel', 'asistio', 'asistencia', 'participacion',
        'noAprobo', 'cancelo', 'agendadoPor', 'fechaAgendamiento', 'origen'];
      const ahoraIso = new Date().toISOString();
      r.bookingsAsistidos = 0; r.bookingsFuturos = 0; r.bookingIds = [];
      for (let i = 0; i < evs.length; i += 200) {
        const lote = evs.slice(i, i + 200);
        const params = [];
        const values = lote.map((e) => {
          const id = bkgId();
          r.bookingIds.push(id);
          if (e.pasada) r.bookingsAsistidos++; else r.bookingsFuturos++;
          const row = [id, e._id, e._id, s.aid, s.aid, s.primerNombre || null, s.primerApellido || null,
            s.numeroId || null, s.celular || null, s.plataforma || null,
            e.nivel || e.tituloONivel || null, e.step || e.nombreEvento || null, e.advisor || '',
            e.dia, e.dia, e.hora || null, e.tipo || e.evento || null, e.tipo || e.evento || null,
            e.linkZoom || null, e.nombreEvento || e.titulo || null, e.tituloONivel || null,
            e.pasada, e.pasada, false, false, false,
            e.pasada ? `Carga histórica asistencia (${CAMP})` : 'Sistema (aprobación contrato)', ahoraIso, 'POSTGRES'];
          const base = params.length;
          params.push(...row);
          return `(${row.map((_, k) => `$${base + k + 1}`).join(',')}, NOW(), NOW())`;
        });
        await client.query(
          `INSERT INTO "ACADEMICA_BOOKINGS" (${cols.map((c) => `"${c}"`).join(',')}, "_createdDate", "_updatedDate")
           VALUES ${values.join(',')}`, params);
      }
      if (evs.length) {
        await client.query(`UPDATE "CALENDARIO" SET "inscritos"=COALESCE("inscritos",0)+1 WHERE "_id" = ANY($1::text[])`,
          [evs.map((e) => e._id)]);
      }
      r.aprobado = true;
    }

    const ok = resultados.filter((r) => r.aprobado);
    if (APPLY && ok.length) {
      await client.query(
        `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","snapshot","motivo","realizadoPor","filasBorradas")
         VALUES ($1,'APROBACION_CARGA_HISTORICA',$2,$3::jsonb,$4,$5,$6::jsonb)`,
        [`prg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, CAMP, JSON.stringify(resultados),
         `Aprobación sin WhatsApp de alumnos en WELCOME con contrato aprobado (${CAMP}), tras la carga histórica de asistencia.`,
         ACTOR, JSON.stringify({ aprobados: ok.length, bookings: ok.reduce((n, r) => n + r.bookingIds.length, 0) })]);
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    const dir = process.env.CARGA_OUT_DIR || path.join(process.cwd(), '.mosaico-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `aprobar-alumnos-${CAMP}-${APPLY ? 'aplicado' : 'ensayo'}-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(resultados, null, 2));
    console.log(APPLY ? '✅ APLICADO' : '🧪 ENSAYO (nada se escribió)');
    console.table(resultados.map(({ bookingIds, ...r }) => r));
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
