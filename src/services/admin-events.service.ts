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
import { REGISTER_OPEN_MIN } from '@/lib/session-window';
import { AdminEventsRepository, AdminEventRow, AdminEventWithAdvisor } from '@/repositories/admin-events.repository';
import {
  AdminEventTipo,
  ADMIN_EVENT_TIPOS,
  ADMIN_EVENT_TIPO_ASIGNACION,
  getAdminEventWindow,
  ADMIN_EVENT_EXPIRED_MESSAGE,
  horaLocal,
  minutosDelDia,
} from '@/lib/admin-event-window';
import { estaAutorizado, autorizacionesDe, marcarAutorizacionUsada } from '@/services/autorizacion-gestion.service';

const TIMEOUT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_HORAS = 12;

/** Duración válida: múltiplo de 0.5 h (30 min) entre 0.5 y MAX_HORAS. */
export function duracionValida(h: unknown): h is number {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0.5 && h <= MAX_HORAS && Number.isInteger(h * 2);
}
const MSG_HORAS = `La duración debe ser múltiplo de 30 minutos, entre 30 min y ${MAX_HORAS} horas`;

/** "30 minutos", "1 hora", "1 hora 30 minutos", "2 horas". */
export function formatDuracion(h: number): string {
  const min = Math.round(h * 60);
  const hh = Math.floor(min / 60), mm = min % 60;
  const partes: string[] = [];
  if (hh) partes.push(`${hh} hora${hh > 1 ? 's' : ''}`);
  if (mm) partes.push(`${mm} minutos`);
  return partes.join(' ');
}

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
  if (!duracionValida(opts.horas)) throw new ValidationError(MSG_HORAS);

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
  /** Guía que aloja: su sala de Zoom es el enlace del evento. Opcional. */
  anfitrionId?: string | null;
}): Promise<{ eventGroupId: string; count: number }> {
  if (!(ADMIN_EVENT_TIPOS as readonly string[]).includes(opts.tipo)) {
    throw new ValidationError(`tipo inválido: ${opts.tipo}`);
  }
  if (opts.titulo && opts.titulo.length > 200) {
    throw new ValidationError('titulo no puede exceder 200 caracteres');
  }
  if (!duracionValida(opts.horas)) throw new ValidationError(MSG_HORAS);
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
    anfitrionId: opts.anfitrionId || null,
  }));
  const count = await AdminEventsRepository.bulkInsert(rows);
  return { eventGroupId, count };
}

/**
 * Asignación Horas Administrativas: Académico le asigna horas a uno o varios guías
 * en una fecha y horario. A diferencia de un evento administrativo, NACEN
 * REGISTRADAS (`registrado=true`, `motivoCierre='ASIGNACION'`): cuentan en Effective
 * y en Administrative Hours sin que el guía haga nada. Como todo evento del mes,
 * se suman una vez que llega su fecha.
 *
 * Mismo bloqueo de choques que un evento administrativo: si el guía ya tiene una
 * clase u otro evento en ese horario, esas horas se estarían contando dos veces.
 */
export async function asignarHorasAdministrativas(opts: {
  advisorIds: string[];
  fechaInicio: string;
  horas: number;
  motivo: string;
  createdBy: string | null;
  tz?: string | null;
}): Promise<{ eventGroupId: string; count: number }> {
  const advisorIds = Array.from(new Set(opts.advisorIds.filter(Boolean)));
  if (advisorIds.length === 0) throw new ValidationError('Selecciona al menos un guía');
  if (!opts.fechaInicio || isNaN(new Date(opts.fechaInicio).getTime())) {
    throw new ValidationError('Fecha y hora de inicio requeridas');
  }
  if (!duracionValida(opts.horas)) throw new ValidationError(MSG_HORAS);
  const motivo = String(opts.motivo || '').trim();
  if (!motivo) throw new ValidationError('Escribe el motivo de las horas asignadas');
  if (motivo.length > 500) throw new ValidationError('El motivo no puede pasar de 500 caracteres');

  const conflicts = await checkConflicts({ advisorIds, fechaInicio: opts.fechaInicio, horas: opts.horas });
  if (conflicts.length > 0) {
    const err = new ConflictError(
      `Hay ${conflicts.length} choque(s) de horario — esas horas ya están ocupadas por otra clase o evento.`,
    ) as any;
    err.detail = conflicts;
    throw err;
  }

  const fin = new Date(new Date(opts.fechaInicio).getTime() + opts.horas * 3_600_000).toISOString();
  const eventGroupId = `aeg_${crypto.randomUUID()}`;
  const count = await AdminEventsRepository.bulkInsert(advisorIds.map(advisorId => ({
    _id: `ae_${crypto.randomUUID()}`,
    eventGroupId,
    advisorId,
    tipo: ADMIN_EVENT_TIPO_ASIGNACION,
    titulo: 'Horas administrativas asignadas',
    descripcion: motivo,
    fechaInicio: opts.fechaInicio,
    horas: opts.horas,
    createdBy: opts.createdBy,
    registrado: true,
    timeout: horaLocal(fin, opts.tz),
    notas: motivo,
    motivoCierre: 'ASIGNACION',
  })));
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
  /** Zona horaria IANA del guía; sin ella se compara en la del servidor (UTC en prod). */
  tz?: string | null;
}): Promise<AdminEventRow> {
  if (!TIMEOUT_REGEX.test(input.timeout)) {
    throw new ValidationError('timeout debe estar en formato HH:MM militar (ej. 09:30)');
  }

  const ev = await AdminEventsRepository.findById(input.id);
  if (!ev) throw new NotFoundError('Admin Event', input.id);
  if (ev.registrado) throw new ConflictError('Este evento ya está registrado');

  // Ventana proporcional a las horas del evento (ej. horas=3 → registro abre
  // a las 3 horas después del inicio, cierra 90 min después).
  let ws = getAdminEventWindow(ev.fechaInicio, input.sessionRole, new Date(), ev.horas);
  // Plazo vencido para el guía: sólo sigue si Coordinación autorizó ESTE evento
  // (columna "Autoriza" de Procesos sin gestión). Que el evento sea suyo se exige
  // igual, más abajo.
  if (!ws.isCoordinator && ws.isExpired && await estaAutorizado('EVENTO_ADMIN', input.id)) {
    ws = getAdminEventWindow(ev.fechaInicio, input.sessionRole, new Date(), ev.horas, true);
  }

  // Nadie confirma un evento que aún no ha empezado — ni el coordinador. Sin esta
  // guarda, "Confirmar los pendientes" daba por cumplida una reunión de la semana
  // siguiente: pasó con la del 28-ago, donde los 25 guías quedaron registrados en
  // 3 segundos, una semana antes. La ventana normal (+30 min) lo cubre para el
  // guía; el coordinador la bypassea, así que hace falta decirlo aquí.
  if (ws.minutesElapsed < REGISTER_OPEN_MIN) {
    const faltan = Math.max(0, REGISTER_OPEN_MIN - ws.minutesElapsed);
    throw new ValidationError(
      `El evento aún no ha empezado (o lleva menos de ${REGISTER_OPEN_MIN} min): `
      + `no se puede confirmar la asistencia todavía${faltan ? ` — faltan ${faltan} min` : ''}.`,
    );
  }

  // Si NO es coordinator, validar ownership + ventana
  if (!ws.isCoordinator) {
    // El advisor debe estar matcheado con ev.advisorId vía su email registrado en ADVISORS
    const adv = await queryOne<{ _id: string }>(
      // TRIM además de LOWER: un espacio al borde del correo lo dejaría fuera
      // con "tu email no está registrado", que es incomprensible para el guía.
      `SELECT "_id" FROM "GUIAS" WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`,
      [input.sessionEmail],
    );
    if (!adv?._id) throw new ForbiddenError('Tu email no está registrado en ADVISORS');
    if (adv._id !== ev.advisorId) throw new ForbiddenError('Este evento no te pertenece');
    if (!ws.canRegister) {
      if (ws.isExpired) throw new ValidationError(ADMIN_EVENT_EXPIRED_MESSAGE);
      const fmtHoras = formatDuracion(ev.horas);
      throw new ValidationError(
        `El evento dura ${fmtHoras} — el registro estará disponible cuando termine (faltan ${ws.minutesUntilRegister} min).`,
      );
    }

    // Defensa B: el Time Out no puede ser anterior al INICIO del evento — la misma
    // regla que en una sesión, donde el guía cierra cuando termina de dictarla y no
    // se le exige esperar al fin nominal.
    //
    // ⚠ Se compara en la zona del GUÍA, que es en la que él teclea la hora.
    // `fechaInicio` es un instante y `getHours()` lo lee en la zona del PROCESO:
    // en producción el servidor corre en UTC, así que una reunión de las 16:00 de
    // Chile se leía como las 20:00 y NINGÚN Time Out que escribiera el guía era
    // aceptable — el registro quedaba bloqueado del todo.
    const inicioLocal = horaLocal(ev.fechaInicio, input.tz);
    if (minutosDelDia(input.timeout) < minutosDelDia(inicioLocal)) {
      throw new ValidationError(
        `Time Out (${input.timeout}) no puede ser anterior a la hora de inicio del evento (${inicioLocal}).`,
      );
    }
  }

  // Quién lo cerró. Si lo hace un coordinador es SIEMPRE gestión suya, aunque sea
  // dentro del plazo del guía: antes sólo se marcaba pasada la ventana, y el
  // registro salía como "confirmado por el guía" cuando en realidad no lo había
  // tocado — que es lo que hacía indistinguible un caso del otro en el detalle.
  // `AUTORIZADO` = lo registró el propio guía fuera de plazo, con la autorización
  // de Coordinación: es registro suyo, pero distinguible de uno hecho a tiempo.
  const motivoCierre: 'NORMAL' | 'GESTION_COORDINADOR' | 'AUTORIZADO' =
    ws.isCoordinator ? 'GESTION_COORDINADOR' : ws.porAutorizacion ? 'AUTORIZADO' : 'NORMAL';

  const notasFinal = (input.notas?.trim() || 'no hubo novedades');

  const updated = await AdminEventsRepository.registrar({
    id: input.id,
    timeout: input.timeout,
    notas: notasFinal,
    motivoCierre,
  });
  if (!updated) throw new ConflictError('Este evento ya está registrado (concurrencia)');
  if (ws.porAutorizacion) await marcarAutorizacionUsada('EVENTO_ADMIN', input.id, input.sessionEmail);
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

  if (patch.horas !== undefined && !duracionValida(patch.horas)) throw new ValidationError(MSG_HORAS);
  if (patch.tipo !== undefined && !(ADMIN_EVENT_TIPOS as readonly string[]).includes(patch.tipo)) {
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
): Promise<Array<AdminEventRow & { autorizadoGestion: boolean }>> {
  const rows = await AdminEventsRepository.listForAdvisorMonth(advisorId, year, month);
  // Cuáles autorizó Coordinación para registrar fuera de plazo: el modal del guía
  // lo necesita para habilitar el registro (el servidor lo vuelve a comprobar).
  const pendientes = rows.filter(r => !r.registrado).map(r => r._id);
  const autorizados = await autorizacionesDe('EVENTO_ADMIN', pendientes);
  return rows.map(r => ({ ...r, autorizadoGestion: autorizados.has(r._id) }));
}

export async function getAdminEventHoursAggregate(
  advisorId: string, year: number, month: number,
): Promise<{ registradas: number; sinRegistrar: number; asignadas: number }> {
  return AdminEventsRepository.aggregateHoursByAdvisorMonth(advisorId, year, month);
}
