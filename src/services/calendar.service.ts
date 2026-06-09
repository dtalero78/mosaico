/**
 * Calendar Service
 *
 * Business logic for event CRUD with cascading operations.
 */

import 'server-only';
import { randomUUID } from 'crypto';
import { CalendarioRepository, EventFilters } from '@/repositories/calendar.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { AdvisorEventLogRepository } from '@/repositories/advisor-event-log.repository';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { withTransaction } from '@/lib/postgres';
import { isEventoCompartible, reasonNotCompartible, MAX_NIVELES_COMPARTIDOS, extractClubPrefix } from '@/lib/evento-compartido';

const MAX_ADVISOR_REASSIGNMENTS = 2;

/**
 * Get events with filters and advisor details.
 */
export async function getEvents(filters: EventFilters) {
  if (filters.includeBookingCounts) {
    return CalendarioRepository.findEventsWithBookingCounts(filters);
  }
  return CalendarioRepository.findEvents(filters);
}

/**
 * Get booking counts for multiple events at once.
 */
export async function getBatchBookingCounts(eventIds: string[]) {
  const rows = await BookingRepository.getBatchCounts(eventIds);

  // Build map with defaults for all requested events
  const countsMap: Record<string, { total: number; asistencias: number; ausencias: number; pendientes: number }> = {};
  for (const id of eventIds) {
    countsMap[id] = { total: 0, asistencias: 0, ausencias: 0, pendientes: 0 };
  }
  for (const row of rows) {
    countsMap[row.eventId] = {
      total: parseInt(row.total) || 0,
      asistencias: parseInt(row.asistencias) || 0,
      ausencias: parseInt(row.ausencias) || 0,
      pendientes: parseInt(row.pendientes) || 0,
    };
  }
  return countsMap;
}

/**
 * Get a single event by ID with advisor details.
 */
export async function getEventById(eventId: string) {
  const event = await CalendarioRepository.findByIdWithAdvisor(eventId);
  if (!event) throw new NotFoundError('Event', eventId);
  return event;
}

/**
 * Create a new calendar event.
 *
 * Si `data.compartidoCon` viene con 1-2 elementos, se crea un grupo compartido:
 *   - El evento base + las filas adicionales reciben el MISMO `eventoCompartidoId` (UUID).
 *   - Cada fila adicional tiene su propio nivel + step pero comparte advisor,
 *     hora, tipo, zoom, límite.
 *   - Solo se permite si `isEventoCompartible(tipo, step)` es true.
 *   - Devuelve el evento base; los hermanos quedan en BD para que cada nivel
 *     los vea normalmente.
 */
export async function createEvent(data: {
  dia: string;
  fecha?: string;
  hora: string;
  advisor: string;
  nivel?: string;
  step?: string;
  tipo: string;
  titulo?: string;
  nombreEvento?: string;
  tituloONivel?: string;
  linkZoom?: string;
  limiteUsuarios?: number;
  club?: string;
  observaciones?: string;
  /** Niveles adicionales para evento compartido (max MAX_NIVELES_COMPARTIDOS-1). */
  compartidoCon?: Array<{ nivel: string; step?: string; nombreEvento?: string; tituloONivel?: string }>;
}) {
  if (!data.dia) throw new ValidationError('dia is required');
  if (!data.hora) throw new ValidationError('hora is required');
  if (!data.tipo) throw new ValidationError('tipo is required');

  const tipo = data.tipo;

  // Validación de compartibilidad: si vienen niveles adicionales,
  // verificamos que el evento base sea compartible y que los niveles
  // adicionales sean distintos al base + únicos entre sí.
  const compartidoCon = Array.isArray(data.compartidoCon) ? data.compartidoCon : [];
  const isCompartido = compartidoCon.length > 0;
  let eventoCompartidoId: string | null = null;

  if (isCompartido) {
    if (compartidoCon.length > MAX_NIVELES_COMPARTIDOS - 1) {
      throw new ValidationError(`Máximo ${MAX_NIVELES_COMPARTIDOS - 1} niveles adicionales (total ${MAX_NIVELES_COMPARTIDOS}).`);
    }
    if (!isEventoCompartible(tipo, data.step)) {
      throw new ValidationError(reasonNotCompartible(tipo, data.step) || 'Este evento no se puede compartir.');
    }
    const baseNivel = (data.nivel || '').trim().toUpperCase();
    const todosNiveles = [baseNivel, ...compartidoCon.map(c => (c.nivel || '').trim().toUpperCase())];
    const uniqueLevels = new Set(todosNiveles.filter(Boolean));
    if (uniqueLevels.size !== todosNiveles.length) {
      throw new ValidationError('Los niveles del grupo compartido deben ser distintos.');
    }
    // Si el evento base es CLUB, los hermanos deben ser del MISMO tipo de club
    // (no mezclar KARAOKE con LISTENING, etc.). Para SESSION Jumps no aplica
    // porque cada nivel tiene su step numérico distinto.
    if ((tipo || '').toUpperCase() === 'CLUB') {
      const basePrefix = extractClubPrefix(data.step);
      if (!basePrefix) {
        throw new ValidationError('No se pudo determinar el tipo de club del step base.');
      }
      for (const adic of compartidoCon) {
        const adicPrefix = extractClubPrefix(adic.step);
        if (adicPrefix !== basePrefix) {
          throw new ValidationError(
            `Todos los niveles del grupo deben ser del mismo tipo de club. Base = ${basePrefix}, nivel ${adic.nivel} = ${adicPrefix || 'desconocido'}.`,
          );
        }
      }
    }
    eventoCompartidoId = randomUUID();
  }

  const baseEventData: Record<string, any> = {
    _id: ids.event(),
    dia: data.dia,
    fecha: data.fecha || data.dia.split('T')[0],
    hora: data.hora,
    advisor: data.advisor,
    nivel: data.nivel || null,
    step: data.step || null,
    tipo: tipo,
    evento: tipo,
    titulo: data.titulo || data.nombreEvento || '',
    nombreEvento: data.nombreEvento || data.titulo || '',
    tituloONivel: data.tituloONivel || (data.nivel ? `${data.nivel} ${data.step || ''}`.trim() : ''),
    linkZoom: data.linkZoom || null,
    limiteUsuarios: data.limiteUsuarios || 0,
    club: data.club || null,
    observaciones: data.observaciones || null,
    eventoCompartidoId,
  };

  if (!isCompartido) {
    return CalendarioRepository.create(baseEventData);
  }

  // Grupo compartido — crear todas las filas en una transacción.
  return withTransaction(async (client) => {
    const baseRow = await CalendarioRepository.create(baseEventData, client);
    for (const adic of compartidoCon) {
      const adicNivel = (adic.nivel || '').trim();
      const adicStep  = (adic.step  || data.step || '').trim();
      // El `step` y el `nombreEvento` son lo mismo para CLUB ("KARAOKE - Step 18")
      // y SESSION ("Step 5") — son la opción que el admin eligió en el dropdown.
      // Si el frontend no manda nombreEvento explícito, lo derivamos del step
      // del ADICIONAL (no del base). Esto fixea el bug donde los 3 hermanos
      // del grupo quedaban con el mismo nombre del base aunque tuvieran steps
      // distintos en BD.
      const adicNombreEvento = (adic.nombreEvento || adicStep || data.nombreEvento || data.titulo || '').trim();
      const adicTituloONivel = adic.tituloONivel
        || (adicNivel ? `${adicNivel} - ${adicNombreEvento || adicStep}`.trim() : '');
      const siblingData = {
        ...baseEventData,
        _id: ids.event(),
        nivel: adicNivel,
        step: adicStep || null,
        nombreEvento: adicNombreEvento,
        tituloONivel: adicTituloONivel,
        titulo: adicNombreEvento || baseEventData.titulo,
      };
      await CalendarioRepository.create(siblingData, client);
    }
    return baseRow;
  });
}

const ALLOWED_EVENT_FIELDS = [
  'dia', 'hora', 'advisor', 'nivel', 'step', 'tipo', 'evento', 'titulo',
  'nombreEvento', 'tituloONivel', 'linkZoom', 'limiteUsuarios', 'club', 'observaciones',
];

/**
 * Update an existing event.
 *
 * Hook Ctrl Horas: si `data.advisor` difiere del actual, registra un snapshot
 * 'Canceled' en ADVISOR_EVENT_LOG para el advisor saliente. Aplica límite de
 * MAX_ADVISOR_REASSIGNMENTS por evento (al exceder, lanza ValidationError).
 * El UPDATE en CALENDARIO y el INSERT en log son atómicos (transacción SQL).
 */
export async function updateEvent(
  eventId: string,
  data: Record<string, any>,
  opts?: { actor?: string; motivo?: string; skipLog?: boolean },
) {
  const event = await CalendarioRepository.findById(eventId);
  if (!event) throw new NotFoundError('Event', eventId);

  // tipo y evento son la MISMA cosa en CALENDARIO (legacy: el campo se llamaba
  // "evento" en Wix, ahora la fuente de verdad es "tipo"). Si el frontend manda
  // sólo uno, sincronizamos ambos para evitar que queden desfasados — bug que
  // ya ocurrió: editar un evento cambiaba sólo una columna y los queries que
  // filtran por la otra dejaban de verlo.
  if (data.tipo || data.evento) {
    const t = data.tipo ?? data.evento;
    data.tipo = t;
    data.evento = t;
  }

  // Derive nivel, step and tituloONivel from the modal data
  if (data.tituloONivel && !data.nivel) {
    data.nivel = data.tituloONivel;
  }
  if (data.nombreEvento && !data.step) {
    // Preserve full nombreEvento as step so CLUB prefixes are kept intact
    // e.g. "TRAINING - Step 3" stays "TRAINING - Step 3", not stripped to "Step 3"
    // SESSION events send nombreEvento = "Step N" so the value is also correct
    data.step = data.nombreEvento;
  }
  // Rebuild tituloONivel as "NIVEL - nombreEvento" for display consistency
  if (data.tituloONivel && data.nombreEvento) {
    data.tituloONivel = `${data.tituloONivel} - ${data.nombreEvento}`.trim();
  }

  // Guarda integridad: cambiar nivel/step de un evento que ya tiene
  // estudiantes inscritos corrompe sus historiales (los bookings quedan
  // apuntando a un nivel/step distinto al que el estudiante realmente cursó).
  // Si el admin quiere "reorganizar" el evento, primero debe desinscribir o
  // cancelar a los estudiantes — esta validación lo fuerza.
  const isNivelChange = !!data.nivel && data.nivel !== event.nivel;
  const isStepChange  = !!data.step  && data.step  !== event.step;
  if (isNivelChange || isStepChange) {
    const activeCount = await CalendarioRepository.countActiveEnrollments(eventId);
    if (activeCount > 0) {
      throw new ValidationError(
        `No se puede cambiar el nivel/step de este evento: tiene ${activeCount} estudiante(s) inscrito(s). Cancela las inscripciones primero o crea un evento nuevo.`,
      );
    }
  }

  const isAdvisorChange = !!data.advisor && data.advisor !== event.advisor;

  let updated: any;
  if (isAdvisorChange) {
    // Límite max 2 reasignaciones por evento — sólo cuenta cuando NO es
    // modo "Restructuración" (skipLog), porque en restructuración no se
    // crean entradas Canceled en el log.
    if (!opts?.skipLog) {
      const prevCanceled = await AdvisorEventLogRepository.countCanceledByEvento(eventId);
      if (prevCanceled >= MAX_ADVISOR_REASSIGNMENTS) {
        throw new ValidationError(
          `Este evento ya tuvo ${MAX_ADVISOR_REASSIGNMENTS} cambios de advisor — no se permite reasignar de nuevo`,
        );
      }
    }

    // Transacción: (opcional INSERT log Canceled) + UPDATE CALENDARIO con
    // clean de notas del advisor saliente. Si skipLog=true (modo
    // "Restructuración"), el cambio NO queda registrado en ADVISOR_EVENT_LOG
    // — útil cuando la reasignación es por error de planificación, no por
    // cancelación real del advisor original.
    updated = await withTransaction(async (client) => {
      if (!opts?.skipLog) {
        await AdvisorEventLogRepository.insert({
          advisorId:     event.advisor,
          eventoId:      eventId,
          estado:        'Canceled',
          fechaEvento:   event.dia,
          horaInicio:    event.hora,
          tipo:          event.tipo,
          nivel:         event.nivel,
          step:          event.step,
          tituloEvento:  event.tituloONivel || event.titulo || event.nombreEvento,
          horaFin:       (event as any).timeout ?? null,
          observaciones: (event as any).notasadvisor ?? null,
          canceladoPor:  opts?.actor || 'system',
          motivoTransicion: opts?.motivo || null,
        }, client);
      }

      // Clean notas del advisor saliente para que el nuevo empiece limpio
      const cleanData = {
        ...data,
        timeout:           null,
        notasadvisor:      null,
        sesionCerrada:     false,
        fechaCierreSesion: null,
      };
      const cleanFields = [...ALLOWED_EVENT_FIELDS, 'timeout', 'notasadvisor', 'sesionCerrada', 'fechaCierreSesion'];
      return CalendarioRepository.updateEvent(eventId, cleanData, cleanFields);
    });
  } else {
    updated = await CalendarioRepository.updateEvent(eventId, data, ALLOWED_EVENT_FIELDS);
  }
  if (!updated) throw new ValidationError('No valid fields to update');

  // Propagate relevant field changes to existing bookings
  const bookingUpdates: Record<string, any> = {};

  if (data.advisor && data.advisor !== event.advisor) bookingUpdates.advisor = data.advisor;
  if (data.linkZoom && data.linkZoom !== event.linkZoom) bookingUpdates.linkZoom = updated.linkZoom || data.linkZoom;
  if (data.nombreEvento && data.nombreEvento !== event.nombreEvento) bookingUpdates.nombreEvento = data.nombreEvento;
  if (data.titulo && data.titulo !== event.titulo) bookingUpdates.titulo = data.titulo;
  if (data.nivel && data.nivel !== event.nivel) bookingUpdates.nivel = data.nivel;
  if (data.step && data.step !== event.step) bookingUpdates.step = data.step;
  if (data.tituloONivel && data.tituloONivel !== event.tituloONivel) bookingUpdates.tituloONivel = data.tituloONivel;
  // tipo cambió (ya está sincronizado con evento arriba) — propaga AMBAS
  // columnas a los bookings hijos (tipo y tipoEvento, legacy Wix).
  if (data.tipo && data.tipo !== event.tipo) { bookingUpdates.tipo = data.tipo; bookingUpdates.tipoEvento = data.tipo; }

  if (Object.keys(bookingUpdates).length > 0) {
    await BookingRepository.updateByEventId(eventId, bookingUpdates);
  }

  // Eventos compartidos: si este evento pertenece a un grupo, propagamos los
  // campos COMUNES (advisor, hora, dia, linkZoom, tipo, observaciones,
  // limiteUsuarios, sesionCerrada, timeout, notasadvisor) a los hermanos.
  // NO propagamos nivel/step/tituloONivel/nombreEvento — esos son específicos
  // por nivel y los hermanos los mantienen tal cual.
  // Si el advisor cambió, también propagamos para mantener consistencia
  // operativa (1 sola clase real del advisor).
  if ((updated as any).eventoCompartidoId) {
    const sharedUpdates: Record<string, any> = {};
    if (data.advisor && data.advisor !== event.advisor) sharedUpdates.advisor = data.advisor;
    if (data.dia && data.dia !== event.dia) sharedUpdates.dia = data.dia;
    if (data.hora && data.hora !== event.hora) sharedUpdates.hora = data.hora;
    if (data.linkZoom && data.linkZoom !== event.linkZoom) sharedUpdates.linkZoom = data.linkZoom;
    if (data.tipo && data.tipo !== event.tipo) { sharedUpdates.tipo = data.tipo; sharedUpdates.evento = data.tipo; }
    if (data.observaciones !== undefined && data.observaciones !== event.observaciones) sharedUpdates.observaciones = data.observaciones;
    if (data.limiteUsuarios !== undefined && data.limiteUsuarios !== event.limiteUsuarios) sharedUpdates.limiteUsuarios = data.limiteUsuarios;
    if (Object.keys(sharedUpdates).length > 0) {
      const n = await CalendarioRepository.updateGroupSiblings(eventId, sharedUpdates);
      // Propaga a los bookings de los hermanos también (no sólo del evento principal).
      if (n > 0 && Object.keys(bookingUpdates).length > 0) {
        const siblings = await CalendarioRepository.findGroupSiblings(eventId);
        for (const sib of siblings) {
          if (sib._id !== eventId) {
            await BookingRepository.updateByEventId(sib._id, bookingUpdates);
          }
        }
      }
    }
  }

  return updated;
}

/**
 * Delete an event, optionally deleting its bookings too.
 *
 * Hook Ctrl Horas: si el evento tiene advisor asignado, por DEFAULT registra
 * un snapshot 'Suspended' en ADVISOR_EVENT_LOG. El INSERT del log, el
 * DELETE de bookings y el DELETE del evento son atómicos (transacción SQL).
 *
 * Modo Restructuración (`opts.skipLog=true`): el admin marcó el checkbox
 * "Restructuración" en el modal de cancelar — el evento se borra LIMPIAMENTE
 * (sin dejar traza en ADVISOR_EVENT_LOG). Útil cuando el evento se elimina
 * por error de planificación, NO porque la sesión haya sido realmente
 * suspendida para el advisor.
 */
export async function deleteEvent(
  eventId: string,
  deleteBookings: boolean = true,
  opts?: { actor?: string; motivo?: string; skipLog?: boolean; deleteGroup?: boolean },
) {
  const event = await CalendarioRepository.findById(eventId);
  if (!event) throw new NotFoundError('Event', eventId);

  // Si es evento compartido y opts.deleteGroup=true, calculamos los hermanos
  // y los procesamos en cascada (cada uno con su log Suspended + bookings).
  // Si deleteGroup=false (o no compartido), borra sólo este evento.
  const isShared = !!(event as any).eventoCompartidoId;
  const idsToDelete: string[] = [eventId];
  if (isShared && opts?.deleteGroup) {
    const siblings = await CalendarioRepository.findGroupSiblings(eventId);
    for (const s of siblings) {
      if (s._id !== eventId) idsToDelete.push(s._id);
    }
  }

  return await withTransaction(async (client) => {
    let bookingsDeleted = 0;
    for (const id of idsToDelete) {
      const ev = id === eventId ? event : await CalendarioRepository.findById(id);
      if (!ev) continue;

      if (ev.advisor && !opts?.skipLog) {
        await AdvisorEventLogRepository.insert({
          advisorId:     ev.advisor,
          eventoId:      id,
          estado:        'Suspended',
          fechaEvento:   ev.dia,
          horaInicio:    ev.hora,
          tipo:          ev.tipo,
          nivel:         ev.nivel,
          step:          ev.step,
          tituloEvento:  ev.tituloONivel || ev.titulo || ev.nombreEvento,
          horaFin:       (ev as any).timeout ?? null,
          observaciones: (ev as any).notasadvisor ?? null,
          canceladoPor:  opts?.actor || 'system',
          motivoTransicion: opts?.motivo || null,
        }, client);
      }

      if (deleteBookings) {
        const r = await client.query(
          `DELETE FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = $1 OR "idEvento" = $1 RETURNING "_id"`,
          [id],
        );
        bookingsDeleted += r.rowCount ?? 0;
      }

      await client.query(`DELETE FROM "CALENDARIO" WHERE "_id" = $1`, [id]);
    }

    return { bookingsDeleted, eventsDeleted: idsToDelete.length };
  });
}

/**
 * Get bookings for an event with attendance stats.
 */
export async function getEventBookings(eventId: string, includeStudent: boolean = false) {
  const rawBookings = includeStudent
    ? await BookingRepository.findByEventIdWithStudentDetails(eventId)
    : await BookingRepository.findByEventId(eventId);

  // Normalize: asistio is the source of truth (asistencia column has stale/inverted data from migration)
  // Also map enriched PEOPLE fields when booking fields are empty
  const bookings = rawBookings.map((b: any) => ({
    ...b,
    email: b.email && b.email !== 'No disponible' ? b.email : b.studentEmail || b.email,
    plataforma: b.plataforma || b.studentPlataforma,
    asistencia: b.asistio != null ? b.asistio : b.asistencia,
  }));

  const stats = {
    total: bookings.length,
    asistencias: bookings.filter((b: any) => b.asistencia === true).length,
    ausencias: bookings.filter((b: any) => b.asistencia === false).length,
    pendientes: bookings.filter((b: any) => b.asistencia === null).length,
  };

  return { bookings, stats };
}
