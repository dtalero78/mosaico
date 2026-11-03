/**
 * Graduación — acto de cierre de los cursos de UN guía.
 *
 * El evento guarda su alcance en los mismos campos de siempre: `campaign`, `curso`
 * ("Todos" o una lista "KODOMO, YOJI") y `salon` ("Todos" o "01, 03"). Los alumnos
 * convocados se DERIVAN de ese alcance + el guía, y se agendan al guardar. Al editar
 * el evento se vuelven a derivar y el agendamiento se ajusta (entran los nuevos, salen
 * los que ya no caen dentro).
 *
 * "Todos" significa todos LOS DEL GUÍA, no todos los de la campaña: la graduación la
 * dicta un guía a sus propios cursos.
 */
import 'server-only';
import { randomUUID } from 'crypto';
import { queryMany } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { enrollStudents, unenrollGraduacion } from '@/services/enrollment.service';
import { updateEvent } from '@/services/calendar.service';

const COMODIN = /^todos?$|^todas?$/i;

/** "A, B" → ['A','B']; vacío o comodín → null (= sin restricción). */
function lista(v: string | null | undefined): string[] | null {
  const s = String(v ?? '').trim();
  if (!s || COMODIN.test(s)) return null;
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export interface AlcanceGraduacion {
  campaign: string;
  advisorId: string;
  curso: string | null | undefined;
  salon: string | null | undefined;
}

/** Salones del guía en la campaña que entran en el alcance, con su conteo de alumnos. */
export async function resolverAlcance(a: AlcanceGraduacion) {
  if (!a.campaign || !a.advisorId) return { academicaIds: [] as string[], salones: [] as any[] };
  const cursos = lista(a.curso);
  const salones = lista(a.salon);

  const rows = await queryMany<any>(
    `SELECT cc."tipoCurso", cc."salon", cc."horarioCurso",
            a."_id" AS "academicaId"
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN "PEOPLE" p
              ON p."tipoUsuario" = 'BENEFICIARIO'
             AND p."campaign" = cc."campaign"
             AND p."tipoCurso" = cc."tipoCurso"
             AND p."horarioCurso" = cc."horarioCurso"
             AND p."salon" IS NOT DISTINCT FROM cc."salon"
             AND p."estadoInactivo" IS NOT TRUE
             AND ${cupoOcupadoSql('p')}
       LEFT JOIN "ACADEMICA" a
              ON a."numeroId" = p."numeroId" AND a."tipoUsuario" = 'BENEFICIARIO'
      WHERE cc."campaign" = $1
        AND cc."guia" = $2
        AND cc."activa" = true
        AND ($3::text[] IS NULL OR cc."tipoCurso" = ANY($3::text[]))
        AND ($4::text[] IS NULL OR cc."salon" = ANY($4::text[]))
      ORDER BY cc."tipoCurso", cc."salon", cc."horarioCurso"`,
    [a.campaign, a.advisorId, cursos, salones],
  );

  const ids = new Set<string>();
  const porSalon = new Map<string, { tipoCurso: string; salon: string | null; horarioCurso: string; alumnos: number }>();
  for (const r of rows) {
    const k = `${r.tipoCurso}|${r.salon}|${r.horarioCurso}`;
    if (!porSalon.has(k)) porSalon.set(k, { tipoCurso: r.tipoCurso, salon: r.salon, horarioCurso: r.horarioCurso, alumnos: 0 });
    if (r.academicaId && !ids.has(r.academicaId)) {
      ids.add(r.academicaId);
      porSalon.get(k)!.alumnos += 1;
    }
  }
  return { academicaIds: [...ids], salones: [...porSalon.values()] };
}

/**
 * Deja agendados EXACTAMENTE los alumnos del alcance: agenda a los que faltan (la
 * graduación prevalece sobre sus otras clases) y da de baja del evento a los que ya
 * no caen dentro. Devuelve los conteos.
 */
export async function sincronizarAlumnos(
  eventId: string,
  academicaIds: string[],
  actor: { nombre?: string; email?: string; rol?: string },
) {
  const actuales = await queryMany<{ bookingId: string; sid: string }>(
    `SELECT "_id" AS "bookingId", COALESCE("idEstudiante", "studentId") AS sid
       FROM "ACADEMICA_BOOKINGS"
      WHERE ("eventoId" = $1 OR "idEvento" = $1) AND "cancelo" = false`,
    [eventId],
  );
  const deseados = new Set(academicaIds);
  const yaEstan = new Set(actuales.map((b) => b.sid));

  const sobran = actuales.filter((b) => !deseados.has(b.sid));
  const faltan = academicaIds.filter((id) => !yaEstan.has(id));

  if (sobran.length > 0) await unenrollGraduacion(eventId, sobran.map((b) => b.bookingId));

  let agendados = 0;
  let canceladas = 0;
  if (faltan.length > 0) {
    const r: any = await enrollStudents({
      eventId,
      studentIds: faltan,
      agendadoPor: actor.nombre || actor.email,
      agendadoPorEmail: actor.email,
      agendadoPorRol: actor.rol,
      sessionRole: actor.rol,
      masivo: true,
    });
    agendados = Array.isArray(r?.bookings) ? r.bookings.length : faltan.length;
    canceladas = Array.isArray(r?.cancelados) ? r.cancelados.length : 0;
  }

  // El límite sigue al número de convocados: un acto de cierre no se llena.
  await queryMany(
    `UPDATE "CALENDARIO" SET "limiteUsuarios" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [eventId, Math.max(academicaIds.length, 1)],
  );

  return { agendados, retirados: sobran.length, canceladas };
}

/** Título que se muestra: "Graduación - KODOMO, YOJI". */
export function tituloGraduacion(curso: string | null | undefined) {
  return `Graduación - ${String(curso || '').trim() || 'Todos'}`;
}

/**
 * Edita una graduación. El tipo NO se puede cambiar. Se pueden cambiar guía, fecha,
 * hora, duración, campaña, cursos y salones; el alcance se conserva tal cual al
 * cambiar de guía (se vuelve a resolver contra los cursos del guía nuevo).
 */
export async function actualizarGraduacion(
  eventId: string,
  body: Record<string, any>,
  opts: { actor: string; motivo?: string; skipLog?: boolean; nombre?: string; rol?: string },
) {
  const ev: any = await CalendarioRepository.findById(eventId);
  if (!ev) throw new NotFoundError('Event', eventId);
  if (String(ev.tipo || ev.evento || '').toUpperCase() !== 'GRADUACION') {
    throw new ValidationError('El evento no es una graduación.');
  }
  const tipoPedido = String(body.tipo ?? body.evento ?? 'GRADUACION').toUpperCase();
  if (tipoPedido !== 'GRADUACION') {
    throw new ValidationError('No se puede cambiar el tipo de una graduación.');
  }

  const campaign = String(body.campaign ?? ev.campaign ?? '').trim();
  const curso = String(body.curso ?? ev.curso ?? '').trim();
  const salon = String(body.salon ?? ev.salon ?? '').trim();
  const advisorId = String(body.advisor ?? ev.advisor ?? '');
  if (!campaign || !curso || !salon) throw new ValidationError('Indica campaña, cursos y salones de la graduación.');

  // El alcance pertenece al guía ORIGINAL: si otro guía la reemplaza, se respetan los
  // cursos, salones y alumnos convocados.
  const guiaAlcance = String(ev.guiaAlcance || ev.advisor || advisorId);
  const { academicaIds } = await resolverAlcance({ campaign, advisorId: guiaAlcance, curso, salon });
  if (academicaIds.length === 0) {
    throw new ValidationError('Con esa selección no hay alumnos del guía para convocar a la graduación.');
  }

  // 1) Lo que ya sabe validar el servicio de calendario: cruce del guía, festivos,
  //    cambio de guía con su bitácora. Siempre lleva al menos un campo válido.
  const dur = Number(body.duracionMin) > 0 ? Number(body.duracionMin) : null;
  const cambiaGuia = !!advisorId && advisorId !== ev.advisor;
  // Con otro guía: el enlace de Zoom es el del guía nuevo (los alumnos ven su nombre
  // y su enlace), aunque el navegador no lo haya mandado.
  let linkZoom: string | undefined = body.linkZoom || undefined;
  if (cambiaGuia && !linkZoom) {
    const g = await queryMany<any>(`SELECT "zoom" FROM "GUIAS" WHERE "_id" = $1`, [advisorId]);
    linkZoom = g[0]?.zoom || undefined;
  }
  await updateEvent(
    eventId,
    {
      dia: body.dia ?? undefined,
      hora: body.hora ?? undefined,
      advisor: advisorId,
      linkZoom,
      observaciones: body.observaciones ?? undefined,
      tipo: 'GRADUACION',
      duracionMin: dur,
    },
    // El reemplazo NO es una cancelación del guía original: sin huella en su bitácora,
    // así sus horas dejan de contarle y pasan al guía asignado.
    { actor: opts.actor, motivo: opts.motivo, skipLog: cambiaGuia ? true : opts.skipLog },
  );

  // 1b) Si el guía ya tenía OTRA graduación a la misma hora, se comparten: quedan
  //     enlazadas (un solo acto para el guía → cuenta como 1 hora, no 2).
  if (cambiaGuia) {
    const otras = await queryMany<any>(
      `SELECT "_id", "eventoCompartidoId" FROM "CALENDARIO"
        WHERE "advisor" = $1 AND "_id" <> $2 AND UPPER(COALESCE("tipo",'')) = 'GRADUACION'
          AND "dia" = (SELECT "dia" FROM "CALENDARIO" WHERE "_id" = $2)`,
      [advisorId, eventId],
    );
    if (otras.length > 0) {
      const grupo = otras.find((o) => o.eventoCompartidoId)?.eventoCompartidoId || randomUUID();
      await queryMany(
        `UPDATE "CALENDARIO" SET "eventoCompartidoId" = $1::uuid, "_updatedDate" = NOW() WHERE "_id" = ANY($2::text[])`,
        [grupo, [eventId, ...otras.map((o) => o._id)]],
      );
    }
  }

  // 2) Lo propio de la graduación, que updateEvent no guarda.
  await CalendarioRepository.updateEvent(
    eventId,
    {
      campaign, curso, salon,
      nivel: curso,
      step: null,
      nombreEvento: 'Graduación',
      tituloONivel: tituloGraduacion(curso),
      titulo: tituloGraduacion(curso),
      duracionMin: dur,
    },
    ['campaign', 'curso', 'salon', 'nivel', 'step', 'nombreEvento', 'tituloONivel', 'titulo', 'duracionMin'],
  );

  // 3) Los alumnos convocados.
  const sync = await sincronizarAlumnos(eventId, academicaIds, { nombre: opts.nombre, email: opts.actor, rol: opts.rol });
  return { total: academicaIds.length, ...sync };
}
