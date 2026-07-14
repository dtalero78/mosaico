import 'server-only';
import { query, queryMany, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { parseHorario, fechasEntre } from '@/lib/cursos-campaign';
import { ValidationError, NotFoundError } from '@/lib/errors';

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * "Repetir Lección" — camino B (mapeo sesión→lección).
 *
 * Cada sesión (evento de CALENDARIO ligado a un CURSOS_CAMPAIGN) cubre una lección
 * del curso, en secuencia por fecha. La secuencia base son las lecciones de NIVELES
 * (por `orden`); cada repetición autorizada DUPLICA su lección en el punto donde va,
 * empujando las siguientes una posición. Así el módulo/lección de cada sesión queda
 * registrado y el avance se "detiene" una lección tras cada repetición.
 */

export interface LeccionSeq { code: string; step: string }

/** Secuencia expandida = lecciones base + repeticiones autorizadas insertadas. */
export function expandirSecuencia(base: LeccionSeq[], repeticiones: Array<{ modulo: string; leccion: string }>): LeccionSeq[] {
  const seq = [...base];
  for (const rep of repeticiones) {
    const idx = seq.findIndex(l => l.code === rep.modulo && l.step === rep.leccion);
    if (idx >= 0) seq.splice(idx + 1, 0, seq[idx]); // duplica la lección repetida
  }
  return seq;
}

/** Lecciones base del curso (ordenadas por orden). */
export async function leccionesBaseCurso(tipoCurso: string): Promise<LeccionSeq[]> {
  const rows = await queryMany<{ code: string; step: string }>(
    `SELECT "code","step" FROM "NIVELES" WHERE "curso"=$1 ORDER BY "orden" NULLS LAST, "step"`, [tipoCurso]
  );
  return rows.map(r => ({ code: r.code, step: r.step }));
}

/**
 * Recalcula el mapeo sesión→lección de un salón (por cursoCampaignId). Asigna a cada
 * sesión (por fecha) la i-ésima lección de la secuencia expandida. Idempotente.
 * NO crea sesiones nuevas ni extiende — eso lo hace la autorización.
 */
export async function mapearLeccionesSalon(cursoCampaignId: string): Promise<number> {
  const cc = await queryOne<{ tipoCurso: string; historicRepet: any }>(
    `SELECT "tipoCurso","historicRepet" FROM "CURSOS_CAMPAIGN" WHERE "_id"=$1`, [cursoCampaignId]
  );
  if (!cc) return 0;

  const base = await leccionesBaseCurso(cc.tipoCurso);
  const hist = Array.isArray(cc.historicRepet) ? cc.historicRepet : [];
  const reps = hist.filter((h: any) => h?.modulo && h?.leccion).map((h: any) => ({ modulo: h.modulo, leccion: h.leccion }));
  const seq = expandirSecuencia(base, reps);

  const sesiones = await queryMany<{ _id: string }>(
    `SELECT "_id" FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 ORDER BY "dia" ASC`, [cursoCampaignId]
  );
  if (sesiones.length === 0) return 0;

  // Batch: un solo UPDATE con arrays paralelos (antes: 1 query por sesión).
  const idsArr: string[] = [];
  const ordArr: Array<number | null> = [];
  const modArr: Array<string | null> = [];
  const lecArr: Array<string | null> = [];
  for (let i = 0; i < sesiones.length; i++) {
    const l = seq[i];
    idsArr.push(sesiones[i]._id);
    ordArr.push(l ? i + 1 : null);
    modArr.push(l?.code || null);
    lecArr.push(l?.step || null);
  }
  await query(
    `UPDATE "CALENDARIO" c
       SET "leccionOrden" = v.ord, "sesionModulo" = v."mod", "sesionLeccion" = v.lec, "_updatedDate" = NOW()
     FROM (SELECT unnest($1::text[]) AS id, unnest($2::int[]) AS ord,
                  unnest($3::text[]) AS "mod", unnest($4::text[]) AS lec) v
     WHERE c."_id" = v.id`,
    [idsArr, ordArr, modArr, lecArr]
  );
  return sesiones.length;
}

/**
 * Autoriza una solicitud de "Repetir Lección": registra en historicRepet, extiende
 * el curso por semanas completas si faltan sesiones (crea eventos + bookings para
 * los usuarios del salón), re-mapea la secuencia y marca el evento autorizado.
 * Requiere que el salón tenga usuarios inscritos.
 */
export async function autorizarRepetir(eventoId: string, comentario: string, autorizadoPor: string) {
  const ev = await queryOne<any>(
    `SELECT c."_id", c."advisor", c."repetirLeccion", c."cursoCampaignId", c."linkZoom",
            cc."tipoCurso", cc."campaign", cc."salon", cc."horarioCurso", cc."numeroUsuarios"
     FROM "CALENDARIO" c LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
     WHERE c."_id" = $1`, [eventoId]);
  if (!ev) throw new NotFoundError('Evento', eventoId);
  if (!ev.cursoCampaignId) throw new ValidationError('El evento no está ligado a un curso de campaña.');

  // Estudiantes del salón (de los bookings del curso). Gate: ≥1 usuario.
  const students = await queryMany<any>(
    `SELECT DISTINCT b."idEstudiante" AS acaid, a."primerNombre", a."primerApellido",
            a."numeroId", a."celular", a."plataforma"
     FROM "ACADEMICA_BOOKINGS" b
     JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     LEFT JOIN "ACADEMICA" a ON a."_id" = b."idEstudiante"
     WHERE c."cursoCampaignId" = $1 AND b."idEstudiante" IS NOT NULL`, [ev.cursoCampaignId]);
  if (students.length === 0) throw new ValidationError('El salón no tiene usuarios inscritos; no se puede repetir la lección.');

  const [modulo, leccion] = String(ev.repetirLeccion || '').split(' - ').map((s) => s.trim());

  // 1) Registrar la autorización en historicRepet.
  const entry = { fecha: new Date().toISOString(), autorizadoPor, comentario: comentario || '', advisor: ev.advisor || null, modulo: modulo || null, leccion: leccion || null };
  await query(
    `UPDATE "CURSOS_CAMPAIGN" SET "historicRepet" = COALESCE("historicRepet",'[]'::jsonb) || $2::jsonb, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [ev.cursoCampaignId, JSON.stringify([entry])]
  );

  // 2) ¿Faltan sesiones? needed = lecciones base + repeticiones autorizadas.
  const base = await leccionesBaseCurso(ev.tipoCurso);
  const histRow = await queryOne<any>(`SELECT "historicRepet" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [ev.cursoCampaignId]);
  const hist = Array.isArray(histRow?.historicRepet) ? histRow.historicRepet : [];
  const needed = base.length + hist.filter((h: any) => h?.modulo && h?.leccion).length;
  const curN = (await queryOne<{ n: number }>(`SELECT COUNT(*)::int n FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [ev.cursoCampaignId]))?.n || 0;
  const lastDia = (await queryOne<{ dia: string }>(`SELECT MAX("dia") AS dia FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [ev.cursoCampaignId]))?.dia;

  let sesionesCreadas = 0;
  let nuevoFinal: string | null = null;
  const parsed = parseHorario(ev.horarioCurso);
  if (curN < needed && lastDia && parsed) {
    // Agregar SEMANAS COMPLETAS hasta cubrir las sesiones faltantes.
    const nuevas: string[] = [];
    let cursor = String(lastDia).slice(0, 10);
    let guard = 0;
    while (curN + nuevas.length < needed && guard < 20) {
      nuevas.push(...fechasEntre(addDaysISO(cursor, 1), addDaysISO(cursor, 7), parsed.dias));
      cursor = addDaysISO(cursor, 7);
      guard++;
    }
    const hora = parsed.hora.length === 4 ? `0${parsed.hora}` : parsed.hora;
    const titulo = [ev.campaign, ev.tipoCurso, ev.salon].filter(Boolean).join(' - ');
    for (const fecha of nuevas) {
      const eid = ids.event();
      await query(
        `INSERT INTO "CALENDARIO" ("_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","_createdDate","_updatedDate")
         VALUES ($1,'SESSION','SESSION',$2,$3,$4::timestamp AT TIME ZONE 'America/Santiago',$5,$6,$7,$7,$8,$9,$10,$11,$12,'POSTGRES',false,NOW(),NOW())`,
        [eid, fecha, hora, `${fecha} ${hora}:00`, ev.advisor || '', ev.tipoCurso, titulo, ev.horarioCurso, ev.linkZoom || null, ev.numeroUsuarios || 12, ev.cursoCampaignId, students.length]
      );
      for (const st of students) {
        await query(
          `INSERT INTO "ACADEMICA_BOOKINGS" ("_id","eventoId","idEvento","studentId","idEstudiante","primerNombre","primerApellido","numeroId","celular","plataforma","nivel","step","advisor","fecha","fechaEvento","hora","tipo","tipoEvento","nombreEvento","tituloONivel","asistio","asistencia","participacion","noAprobo","cancelo","agendadoPor","fechaAgendamiento","origen","_createdDate","_updatedDate")
           VALUES ($1,$2,$2,$3,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$11,$12,'SESSION','SESSION',$13,$13,false,false,false,false,false,'Sistema (repetir lección)',NOW(),'POSTGRES',NOW(),NOW())`,
          [ids.booking(), eid, st.acaid, st.primerNombre || null, st.primerApellido || null, st.numeroId || null, st.celular || null, st.plataforma || null, ev.tipoCurso, ev.advisor || null, `${fecha} ${hora}:00`, hora, titulo]
        );
      }
      sesionesCreadas++;
      nuevoFinal = fecha;
    }
    if (nuevoFinal) {
      await query(`UPDATE "CURSOS_CAMPAIGN" SET "finalCurso" = $2::date, "_updatedDate" = NOW() WHERE "_id" = $1`, [ev.cursoCampaignId, nuevoFinal]);
    }
  }

  // 3) Re-mapear la secuencia (la repetición ya está en historicRepet).
  await mapearLeccionesSalon(ev.cursoCampaignId);

  // 4) Marcar el evento autorizado (sale de pendientes).
  await query(
    `UPDATE "CALENDARIO" SET "autorizadoRepetir" = true, "fechaAutorizadoRepetir" = NOW(), "autorizadoRepetirPor" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [eventoId, autorizadoPor]
  );

  return {
    curso: ev.tipoCurso, salon: ev.salon, campaign: ev.campaign,
    leccion: ev.repetirLeccion, estudiantes: students.length,
    sesionesCreadas, nuevoFinalCurso: nuevoFinal,
  };
}

/**
 * Rechaza una solicitud: decrementa repetClass, anula la marca del evento y NO
 * toca finalCurso ni historicRepet.
 */
export async function rechazarRepetir(eventoId: string) {
  const ev = await queryOne<{ cursoCampaignId: string | null; repetirSesion: boolean | null }>(
    `SELECT "cursoCampaignId","repetirSesion" FROM "CALENDARIO" WHERE "_id" = $1`, [eventoId]);
  if (!ev) throw new NotFoundError('Evento', eventoId);

  await query(
    `UPDATE "CALENDARIO" SET "repetirSesion" = false, "repetirLeccion" = NULL, "fechaRepetirSesion" = NULL, "autorizadoRepetir" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [eventoId]
  );
  if (ev.repetirSesion === true && ev.cursoCampaignId) {
    await query(`UPDATE "CURSOS_CAMPAIGN" SET "repetClass" = GREATEST(0, COALESCE("repetClass",0) - 1), "_updatedDate" = NOW() WHERE "_id" = $1`, [ev.cursoCampaignId]);
  }
  return { rechazado: true };
}
