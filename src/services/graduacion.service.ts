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
  // 'Todos'/'Todas' = todas las campañas del guía.
  const campana = COMODIN.test(String(a.campaign).trim()) ? null : a.campaign;
  const cursos = lista(a.curso);
  const salones = lista(a.salon);

  const rows = await queryMany<any>(
    `SELECT cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
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
      WHERE ($1::text IS NULL OR cc."campaign" = $1)
        AND cc."guia" = $2
        AND cc."activa" = true
        AND ($3::text[] IS NULL OR cc."tipoCurso" = ANY($3::text[]))
        AND ($4::text[] IS NULL OR cc."salon" = ANY($4::text[]))
      ORDER BY cc."tipoCurso", cc."salon", cc."horarioCurso"`,
    [campana, a.advisorId, cursos, salones],
  );

  const ids = new Set<string>();
  const porSalon = new Map<string, { campaign?: string; tipoCurso: string; salon: string | null; horarioCurso: string; alumnos: number }>();
  for (const r of rows) {
    const k = `${r.campaign}|${r.tipoCurso}|${r.salon}|${r.horarioCurso}`;
    if (!porSalon.has(k)) porSalon.set(k, { campaign: r.campaign, tipoCurso: r.tipoCurso, salon: r.salon, horarioCurso: r.horarioCurso, alumnos: 0 });
    if (r.academicaId && !ids.has(r.academicaId)) {
      ids.add(r.academicaId);
      porSalon.get(k)!.alumnos += 1;
    }
  }
  // Cursos CERRADOS en Ajuste Cursos: sus alumnos quedaron inactivos y sin curso, pero
  // son justo a quienes se gradúa. Se reconocen por la bitácora de cupo (la salida
  // por cierre de ESE curso) y sólo mientras no hayan vuelto a otro salón.
  const cerrados = await queryMany<any>(
    `SELECT DISTINCT cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso", a."_id" AS "academicaId"
       FROM "CURSOS_CAMPAIGN" cc
       JOIN "PEOPLE" p ON p."tipoUsuario" = 'BENEFICIARIO' AND p."campaign" IS NULL
       JOIN LATERAL jsonb_array_elements(COALESCE(p."cupoHistory",'[]'::jsonb)) e ON
            e->>'campaign' = cc."campaign" AND e->>'tipoCurso' = cc."tipoCurso"
        AND e->>'horarioCurso' = cc."horarioCurso" AND e->>'salon' IS NOT DISTINCT FROM cc."salon"
        AND e->>'motivo' ILIKE 'Curso cerrado en Ajuste Cursos%'
       JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId" AND a."tipoUsuario" = 'BENEFICIARIO'
      WHERE ($1::text IS NULL OR cc."campaign" = $1) AND cc."guia" = $2 AND cc."activa" = true
        AND ($3::text[] IS NULL OR cc."tipoCurso" = ANY($3::text[]))
        AND ($4::text[] IS NULL OR cc."salon" = ANY($4::text[]))`,
    [campana, a.advisorId, cursos, salones],
  ).catch(() => [] as any[]);
  for (const r of cerrados) {
    const k = `${r.campaign}|${r.tipoCurso}|${r.salon}|${r.horarioCurso}`;
    if (!porSalon.has(k)) porSalon.set(k, { campaign: r.campaign, tipoCurso: r.tipoCurso, salon: r.salon, horarioCurso: r.horarioCurso, alumnos: 0 });
    if (r.academicaId && !ids.has(r.academicaId)) { ids.add(r.academicaId); porSalon.get(k)!.alumnos += 1; }
  }
  return { academicaIds: [...ids], salones: [...porSalon.values()] };
}

/** Por qué un alcance no convoca a nadie: dice qué se encontró para poder corregir la selección. */
export function mensajeSinAlumnos(alc: { salones: Array<{ tipoCurso: string; salon: string | null; alumnos: number }> }, campaign: string) {
  if (!alc.salones.length) {
    return `El guía no tiene cursos activos en la campaña ${campaign} con esa selección de cursos y salones. Revisa la campaña, el guía o los salones elegidos.`;
  }
  const det = alc.salones.map(x => `${x.tipoCurso} ${x.salon || '—'}`).join(', ');
  return `Los cursos del guía en ${campaign} (${det}) no tienen alumnos activos que ocupen cupo, así que no hay a quién convocar a la graduación.`;
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
      permitirInactivos: true,
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
  const alc0 = await resolverAlcance({ campaign, advisorId: guiaAlcance, curso, salon });
  const { academicaIds } = alc0;
  if (academicaIds.length === 0) {
    throw new ValidationError(mensajeSinAlumnos(alc0, campaign));
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

// ───────────────────────── Graduaciones conjuntas ─────────────────────────
// Varias graduaciones (del mismo guía o de otros) pueden realizarse JUNTAS: se crean
// de a una y después se unen. Quedan enlazadas con el mismo `eventoCompartidoId`, a la
// misma fecha, hora, duración, guía y enlace de Zoom. Cada una conserva sus alumnos.

const esGrad = (e: any) => String(e?.tipo || e?.evento || '').toUpperCase() === 'GRADUACION';

/** Las graduaciones ya enlazadas con ésta (incluida) y las que se le pueden unir. */
export async function graduacionesParaUnir(eventId: string) {
  const ev: any = await CalendarioRepository.findById(eventId);
  if (!ev) throw new NotFoundError('Event', eventId);
  if (!esGrad(ev)) throw new ValidationError('El evento no es una graduación.');
  const sel = `SELECT c."_id", c."dia", c."hora", c."duracionMin", c."advisor", g."nombreCompleto" AS "guia",
                      c."campaign", c."curso", c."salon", c."eventoCompartidoId", c."sesionCerrada",
                      (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" b
                        WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id") AND COALESCE(b."cancelo", false) = false) AS "convocados"
                 FROM "CALENDARIO" c LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"`;
  const grupo = ev.eventoCompartidoId
    ? await queryMany<any>(`${sel} WHERE c."eventoCompartidoId" = $1::uuid ORDER BY c."dia", g."nombreCompleto"`, [ev.eventoCompartidoId])
    : [];
  const unibles = await queryMany<any>(
    `${sel} WHERE UPPER(COALESCE(c."tipo",'')) = 'GRADUACION' AND c."_id" <> $1
        AND COALESCE(c."sesionCerrada", false) = false AND c."dia" >= NOW() - INTERVAL '1 day'
        AND (c."eventoCompartidoId" IS NULL OR $2::uuid IS NULL OR c."eventoCompartidoId" <> $2::uuid)
      ORDER BY c."dia", g."nombreCompleto"`,
    [eventId, ev.eventoCompartidoId || null],
  );
  return { grupo, unibles };
}

/**
 * Une otras graduaciones a ésta: las lleva a su fecha, hora, duración y Zoom, las pasa al
 * guía de ésta y las deja enlazadas. Los alumnos convocados NO cambian.
 */
export async function unirGraduaciones(eventId: string, otrosIds: string[], actor: { actor: string }) {
  const ev: any = await CalendarioRepository.findById(eventId);
  if (!ev) throw new NotFoundError('Event', eventId);
  if (!esGrad(ev)) throw new ValidationError('El evento no es una graduación.');
  const pedidos = Array.from(new Set((otrosIds || []).filter((x) => x && x !== eventId)));
  if (!pedidos.length) throw new ValidationError('Elige al menos una graduación para unir.');
  if (ev.sesionCerrada === true) throw new ValidationError('Esta graduación ya se registró; no se puede unir.');

  const diaISO = new Date(ev.dia).toISOString();
  const dur = Number(ev.duracionMin) > 0 ? Number(ev.duracionMin) : null;
  let grupo: string = ev.eventoCompartidoId || '';
  const todos = new Set<string>([eventId]);
  if (ev.eventoCompartidoId) {
    (await CalendarioRepository.findGroupSiblings(eventId)).forEach((s: any) => todos.add(s._id));
  }

  for (const id of pedidos) {
    const o: any = await CalendarioRepository.findById(id);
    if (!o) throw new NotFoundError('Event', id);
    if (!esGrad(o)) throw new ValidationError('Sólo se pueden unir graduaciones.');
    if (o.sesionCerrada === true) throw new ValidationError('Una de las graduaciones ya se registró; no se puede mover.');
    // El alcance (alumnos) pertenece al guía ORIGINAL: se fija antes de cambiar de guía.
    if (!o.guiaAlcance && o.advisor) {
      await CalendarioRepository.updateEvent(id, { guiaAlcance: String(o.advisor) }, ['guiaAlcance']);
    }
    // Mueve la graduación a la fecha/hora/duración/Zoom de ésta y pasa a este guía.
    const mueve = String(o.advisor || '') !== String(ev.advisor || '') || new Date(o.dia).getTime() !== new Date(ev.dia).getTime()
      || String(o.hora) !== String(ev.hora) || (Number(o.duracionMin) || null) !== dur
      || (ev.linkZoom && o.linkZoom !== ev.linkZoom);
    if (mueve) {
      await updateEvent(id, {
        dia: diaISO, hora: ev.hora, duracionMin: dur, advisor: ev.advisor,
        ...(ev.linkZoom ? { linkZoom: ev.linkZoom } : {}), tipo: 'GRADUACION',
      }, { actor: actor.actor, skipLog: true });
    }
    todos.add(id);
    if (o.eventoCompartidoId) {
      (await CalendarioRepository.findGroupSiblings(id)).forEach((s: any) => todos.add(s._id));
      if (!grupo) grupo = o.eventoCompartidoId;
    }
  }
  if (!grupo) grupo = randomUUID();
  await queryMany(
    `UPDATE "CALENDARIO" SET "eventoCompartidoId" = $1::uuid, "_updatedDate" = NOW() WHERE "_id" = ANY($2::text[])`,
    [grupo, [...todos]],
  );
  return { grupo, unidas: pedidos.length };
}

/** Saca una graduación del grupo (conserva su fecha y Zoom). Si queda sola, el grupo se disuelve. */
export async function separarGraduacion(eventId: string) {
  const ev: any = await CalendarioRepository.findById(eventId);
  if (!ev) throw new NotFoundError('Event', eventId);
  if (!ev.eventoCompartidoId) return { separada: false };
  const grupo = ev.eventoCompartidoId;
  await queryMany(`UPDATE "CALENDARIO" SET "eventoCompartidoId" = NULL, "_updatedDate" = NOW() WHERE "_id" = $1`, [eventId]);
  const quedan = await queryMany<any>(`SELECT "_id" FROM "CALENDARIO" WHERE "eventoCompartidoId" = $1::uuid`, [grupo]);
  if (quedan.length === 1) {
    await queryMany(`UPDATE "CALENDARIO" SET "eventoCompartidoId" = NULL, "_updatedDate" = NOW() WHERE "_id" = $1`, [quedan[0]._id]);
  }
  return { separada: true };
}
