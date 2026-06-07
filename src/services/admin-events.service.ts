/**
 * Admin Events Service — lógica de negocio para eventos administrativos.
 *
 * Reglas clave:
 *   - Creación: BLOQUEAR si hay conflicto con CALENDARIO académico (el académico
 *     prima) o con otro admin event del mismo advisor en la misma franja.
 *   - Registro: solo dentro de la ventana +40..+120 min (advisor) o
 *     bypass por COORDINADOR_ACADEMICO / SUPER_ADMIN / ADMIN.
 *   - Edición: solo si NO está registrado.
 *   - Eliminación: granular (1 fila) o por grupo entero.
 */
import 'server-only';
import crypto from 'crypto';
import { ValidationError, ForbiddenError, NotFoundError, ConflictError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { AdminEventsRepository, AdminEventRow, AdminEventWithAdvisor } from '@/repositories/admin-events.repository';
import {
  AdminEventTipo,
  ADMIN_EVENT_TIPOS,
  getAdminEventWindow,
  ADMIN_EVENT_EXPIRED_MESSAGE,
} from '@/lib/admin-event-window';

const TIMEOUT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_HORAS = 12;

export interface ConflictDetail {
  source: 'CALENDARIO' | 'ADMIN_EVENTS';
  advisorId: string;
  advisorNombre: string | null;
  eventoId: string;
  fecha: string;
  tipo: string | null;
  descripcion: string | null;
}

/**
 * Detecta TODOS los conflictos para una propuesta (advisorIds + rango horario).
 * Retorna lista vacía si no hay conflictos.
 */
export async function checkConflicts(opts: {
  advisorIds: string[];
  fechaInicio: string;
  horas: number;
  excludeGroupId?: string | null;
}): Promise<ConflictDetail[]> {
  if (opts.advisorIds.length === 0) {
    throw new ValidationError('advisorIds requerido (array no vacío)');
  }
  if (!opts.fechaInicio) throw new ValidationError('fechaInicio requerido');
  if (!Number.isInteger(opts.horas) || opts.horas < 1 || opts.horas > MAX_HORAS) {
    throw new ValidationError(`horas debe ser entero entre 1 y ${MAX_HORAS}`);
  }

  // 1) Conflictos con CALENDARIO (sesiones académicas)
  const cal = await AdminEventsRepository.findConflictsInCalendario(
    opts.advisorIds, opts.fechaInicio, opts.horas,
  );

  // 2) Conflictos con OTROS admin events del mismo advisor
  const adm = await AdminEventsRepository.findConflictsInAdminEvents(
    opts.advisorIds, opts.fechaInicio, opts.horas, opts.excludeGroupId,
  );

  const conflicts: ConflictDetail[] = [
    ...cal.map(c => ({
      source: 'CALENDARIO' as const,
      advisorId: c.advisorId,
      advisorNombre: c.advisorNombre,
      eventoId: c.eventoId,
      fecha: c.dia,
      tipo: c.tipo,
      descripcion: c.tituloONivel,
    })),
    ...adm.map(a => ({
      source: 'ADMIN_EVENTS' as const,
      advisorId: a.advisorId,
      advisorNombre: null,
      eventoId: a.eventGroupId,
      fecha: a.fechaInicio,
      tipo: a.tipo,
      descripcion: `Evento administrativo (${a.horas}h)`,
    })),
  ];

  return conflicts;
}

/**
 * Crea N admin events (1 por advisor). Si hay conflictos, lanza ConflictError
 * con el detalle adjunto en err.detail.
 */
export async function createAdminEvents(opts: {
  advisorIds: string[];
  tipo: AdminEventTipo;
  titulo: string | null;
  descripcion: string | null;
  fechaInicio: string;
  horas: number;
  createdBy: string | null;
}): Promise<{ eventGroupId: string; count: number }> {
  if (!ADMIN_EVENT_TIPOS.includes(opts.tipo)) {
    throw new ValidationError(`tipo inválido: ${opts.tipo}`);
  }
  if (opts.titulo && opts.titulo.length > 200) {
    throw new ValidationError('titulo no puede exceder 200 caracteres');
  }
  if (!Number.isInteger(opts.horas) || opts.horas < 1 || opts.horas > MAX_HORAS) {
    throw new ValidationError(`horas debe ser entero entre 1 y ${MAX_HORAS}`);
  }
  if (opts.advisorIds.length === 0) {
    throw new ValidationError('Debes seleccionar al menos un advisor');
  }

  // Validación de conflictos — BLOQUEAR si hay cualquiera
  const conflicts = await checkConflicts({
    advisorIds: opts.advisorIds,
    fechaInicio: opts.fechaInicio,
    horas: opts.horas,
  });
  if (conflicts.length > 0) {
    const err = new ConflictError(
      `Hay ${conflicts.length} conflicto(s) — resuélvelos antes de crear el evento. El agendamiento académico prima.`,
    ) as any;
    err.detail = conflicts;
    throw err;
  }

  const eventGroupId = `aeg_${crypto.randomUUID()}`;
  const rows = opts.advisorIds.map(advisorId => ({
    _id: `ae_${crypto.randomUUID()}`,
    eventGroupId,
    advisorId,
    tipo: opts.tipo,
    titulo: opts.titulo,
    descripcion: opts.descripcion,
    fechaInicio: opts.fechaInicio,
    horas: opts.horas,
    createdBy: opts.createdBy,
  }));
  const count = await AdminEventsRepository.bulkInsert(rows);
  return { eventGroupId, count };
}

/**
 * Registra un admin event (advisor "marca tarjeta").
 * Reglas:
 *   - Advisor: solo si es el dueño AND está en ventana +40..+120
 *   - Coordinator/admin: bypass total. Si está vencido y lo cierra coordinator,
 *     motivoCierre='GESTION_COORDINADOR'.
 */
export async function registrarAdminEvent(input: {
  id: string;
  sessionEmail: string;
  sessionRole: string;
  timeout: string;
  notas: string | null;
}): Promise<AdminEventRow> {
  if (!TIMEOUT_REGEX.test(input.timeout)) {
    throw new ValidationError('timeout debe estar en formato HH:MM militar (ej. 09:30)');
  }

  const ev = await AdminEventsRepository.findById(input.id);
  if (!ev) throw new NotFoundError('Admin Event', input.id);
  if (ev.registrado) throw new ConflictError('Este evento ya está registrado');

  // Ventana proporcional a las horas del evento (ej. horas=3 → registro abre
  // a las 3 horas después del inicio, cierra 90 min después).
  const ws = getAdminEventWindow(ev.fechaInicio, input.sessionRole, new Date(), ev.horas);

  // Si NO es coordinator, validar ownership + ventana
  if (!ws.isCoordinator) {
    // El advisor debe estar matcheado con ev.advisorId vía su email registrado en ADVISORS
    const adv = await queryOne<{ _id: string }>(
      `SELECT "_id" FROM "ADVISORS" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
      [input.sessionEmail],
    );
    if (!adv?._id) throw new ForbiddenError('Tu email no está registrado en ADVISORS');
    if (adv._id !== ev.advisorId) throw new ForbiddenError('Este evento no te pertenece');
    if (!ws.canRegister) {
      if (ws.isExpired) throw new ValidationError(ADMIN_EVENT_EXPIRED_MESSAGE);
      const fmtHoras = ev.horas > 1 ? `${ev.horas} horas` : '1 hora';
      throw new ValidationError(
        `El evento dura ${fmtHoras} — el registro estará disponible cuando termine (faltan ${ws.minutesUntilRegister} min).`,
      );
    }

    // Defensa B: validar que el timeout no sea ANTES del fin nominal.
    // El advisor podría cerrar más tarde (margen post-fin), pero nunca antes
    // de que el evento haya terminado nominalmente.
    const finNominalDate = new Date(new Date(ev.fechaInicio).getTime() + ws.finNominalMin * 60_000);
    const [hh, mm] = input.timeout.split(':').map(Number);
    const timeoutDate = new Date(finNominalDate);
    timeoutDate.setHours(hh, mm, 0, 0);
    // Si timeout cae antes de fin nominal en el mismo día, ajustamos al día siguiente
    // (caso raro: evento nocturno que cruza medianoche). Si igual queda antes, rechazamos.
    if (timeoutDate < finNominalDate) {
      const finHH = String(finNominalDate.getHours()).padStart(2, '0');
      const finMM = String(finNominalDate.getMinutes()).padStart(2, '0');
      throw new ValidationError(
        `Time Out (${input.timeout}) no puede ser anterior a la hora de fin del evento (${finHH}:${finMM}).`,
      );
    }
  }

  // motivoCierre: si lo cierra coord y ya pasó la ventana → GESTION_COORDINADOR.
  // El umbral ahora es relativo a la duración del evento.
  const motivoCierre: 'NORMAL' | 'GESTION_COORDINADOR' =
    ws.isCoordinator && ws.minutesElapsed > ws.finNominalMin + 90 ? 'GESTION_COORDINADOR' : 'NORMAL';

  const notasFinal = (input.notas?.trim() || 'no hubo novedades');

  const updated = await AdminEventsRepository.registrar({
    id: input.id,
    timeout: input.timeout,
    notas: notasFinal,
    motivoCierre,
  });
  if (!updated) throw new ConflictError('Este evento ya está registrado (concurrencia)');
  return updated;
}

/** Edita un admin event si NO está registrado. */
export async function updateAdminEvent(id: string, patch: Partial<{
  tipo: AdminEventTipo;
  titulo: string | null;
  descripcion: string | null;
  fechaInicio: string;
  horas: number;
}>): Promise<AdminEventRow> {
  const existing = await AdminEventsRepository.findById(id);
  if (!existing) throw new NotFoundError('Admin Event', id);
  if (existing.registrado) {
    throw new ValidationError('No se puede editar — el evento ya fue registrado por el advisor');
  }

  if (patch.horas !== undefined && (!Number.isInteger(patch.horas) || patch.horas < 1 || patch.horas > MAX_HORAS)) {
    throw new ValidationError(`horas debe ser entero entre 1 y ${MAX_HORAS}`);
  }
  if (patch.tipo !== undefined && !ADMIN_EVENT_TIPOS.includes(patch.tipo)) {
    throw new ValidationError(`tipo inválido: ${patch.tipo}`);
  }
  if (patch.titulo !== undefined && patch.titulo && patch.titulo.length > 200) {
    throw new ValidationError('titulo no puede exceder 200 caracteres');
  }

  // Si cambia fecha/horas, re-validar conflictos (excluyendo el propio grupo)
  if (patch.fechaInicio !== undefined || patch.horas !== undefined) {
    const conflicts = await checkConflicts({
      advisorIds: [existing.advisorId],
      fechaInicio: patch.fechaInicio ?? existing.fechaInicio,
      horas: patch.horas ?? existing.horas,
      excludeGroupId: existing.eventGroupId,
    });
    if (conflicts.length > 0) {
      const err = new ConflictError('Hay conflictos con el nuevo horario — el académico prima.') as any;
      err.detail = conflicts;
      throw err;
    }
  }

  const updated = await AdminEventsRepository.update(id, patch);
  if (!updated) throw new ConflictError('No se pudo actualizar — quizás ya fue registrado');
  return updated;
}

export async function deleteAdminEvent(id: string): Promise<number> {
  return AdminEventsRepository.deleteById(id);
}

export async function deleteAdminEventGroup(eventGroupId: string): Promise<number> {
  return AdminEventsRepository.deleteByGroupId(eventGroupId);
}

/** Para el listado del admin (con filtros). */
export async function listAdminEvents(opts: {
  startDate?: string | null;
  endDate?: string | null;
  advisorId?: string | null;
  tipo?: AdminEventTipo | null;
  registrado?: boolean | null;
}): Promise<AdminEventWithAdvisor[]> {
  return AdminEventsRepository.listForAdmin(opts);
}

/** Para integración con UI del advisor (panel + ctrl-horas). */
export async function listAdminEventsForAdvisorMonth(
  advisorId: string, year: number, month: number,
): Promise<AdminEventRow[]> {
  return AdminEventsRepository.listForAdvisorMonth(advisorId, year, month);
}

export async function getAdminEventHoursAggregate(
  advisorId: string, year: number, month: number,
): Promise<{ registradas: number; sinRegistrar: number }> {
  return AdminEventsRepository.aggregateHoursByAdvisorMonth(advisorId, year, month);
}
