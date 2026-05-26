/**
 * AdvisorEventLog Service — Ctrl Horas
 *
 * Lógica de negocio:
 *   - Vista mensual del advisor: vigentes (CALENDARIO) + históricos (LOG)
 *   - Edición de timeout / notasadvisor por el advisor (con reglas temporales)
 *   - Cierre de sesión por el advisor (botón "Registrar Sesión")
 *
 * Reglas temporales para edición:
 *   - Editable desde: NOW >= fechaEvento + 30 min
 *   - Editable hasta: sesionCerrada=false (una vez cerrada → solo lectura)
 *   - Histórico (Canceled/Suspended) → siempre solo lectura
 *
 * Validaciones de timeout:
 *   - Formato militar "HH:MM" (00:00 a 23:59)
 *   - timeout > horaInicio (no puede salir antes de empezar)
 *
 * Permisos:
 *   - El advisor solo puede tocar SUS eventos (validado por email vs ADVISORS)
 *   - Admin puede consultar pero NO editar (la edición es del advisor)
 */

import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { AdvisorEventLogRepository, AdvisorEventLogRow } from '@/repositories/advisor-event-log.repository';
import { AdvisorNotesAuditRepository } from '@/repositories/advisor-notes-audit.repository';

const TIMEOUT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const EDIT_WINDOW_MIN_MINUTES = 30;
const TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+)?$/;

// ────────────────────────────── tipos ──────────────────────────────

export interface VigenteRow {
  source: 'CALENDARIO';
  eventoId: string;
  fechaEvento: string;
  horaInicio: string | null;
  tipo: string | null;
  nivel: string | null;
  step: string | null;
  tituloEvento: string | null;
  observacionesEvento: string | null;   // del admin (CALENDARIO.observaciones)
  timeout: string | null;
  notasadvisor: string | null;
  sesionCerrada: boolean;
  fechaCierreSesion: string | null;
  inscritos: number;
  asistieron: number;
  absent: number;                        // calculado: inscritos - asistieron
  estado: 'Conducted';
  canEdit: boolean;                      // computado a partir de las reglas temporales
  editReason: string | null;             // si !canEdit, explica por qué
}

export interface HistoricoRow {
  source: 'LOG';
  logId: string;
  eventoId: string;
  fechaEvento: string;
  horaInicio: string | null;
  tipo: string | null;
  nivel: string | null;
  step: string | null;
  tituloEvento: string | null;
  timeout: string | null;
  notasadvisor: string | null;
  estado: 'Canceled' | 'Suspended';
  canceladoPor: string;
  fechaTransicion: string;
  motivoTransicion: string | null;
}

export interface MonthlyView {
  advisorId: string;
  year: number;
  month: number;                  // 1-12
  vigentes: VigenteRow[];
  historicos: HistoricoRow[];
}

// ────────────────────────────── helpers ──────────────────────────────

function monthRange(year: number, month: number): { fromISO: string; toISO: string } {
  // [first day of month, first day of next month)
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to   = new Date(Date.UTC(year, month, 1));
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

/**
 * Decide si el advisor puede editar timeout/notasadvisor de un evento vigente.
 * Reglas:
 *   - fechaEvento debe haber comenzado hace al menos 30 min
 *   - sesionCerrada debe ser false
 */
function computeEditability(
  fechaEvento: Date,
  sesionCerrada: boolean,
): { canEdit: boolean; editReason: string | null } {
  if (sesionCerrada) return { canEdit: false, editReason: 'La sesión ya fue registrada (cerrada).' };
  const now = Date.now();
  const eventStart = fechaEvento.getTime();
  const elapsedMin = (now - eventStart) / (1000 * 60);
  if (elapsedMin < EDIT_WINDOW_MIN_MINUTES) {
    return {
      canEdit: false,
      editReason: `Disponible 30 min después del inicio del evento (faltan ${Math.ceil(EDIT_WINDOW_MIN_MINUTES - elapsedMin)} min).`,
    };
  }
  return { canEdit: true, editReason: null };
}

/**
 * Resuelve el ADVISORS._id a partir del email de sesión.
 * Cero matches → null. Múltiples → primero por orden alfabético (defensivo).
 */
async function resolveAdvisorIdByEmail(email: string): Promise<string | null> {
  const row = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "ADVISORS" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
    [email],
  );
  return row?._id ?? null;
}

// ────────────────────────────── API pública ──────────────────────────────

/**
 * Vista mensual del advisor: une eventos vigentes (CALENDARIO) con históricos (LOG).
 * Agrupa counts de inscritos/asistieron en una sola query por eficiencia.
 */
export async function buildMonthlyView(
  advisorId: string,
  year: number,
  month: number,
): Promise<MonthlyView> {
  const { fromISO, toISO } = monthRange(year, month);

  // Nota perf: el LATERAL JOIN usa `b."eventoId" = c._id OR b."idEvento" = c._id`
  // en vez de `COALESCE(b."eventoId", b."idEvento") = c._id` porque COALESCE
  // dentro de WHERE bloquea el uso de índices (idx_bookings_evento y
  // idx_bookings_idevento), forzando Seq Scan sobre los 160k bookings por
  // cada evento del mes. Con OR, Postgres usa BitmapOr y combina ambos índices.
  const vigentesRows = await queryMany<any>(
    `SELECT
       c."_id"                AS "eventoId",
       c."dia"                AS "fechaEvento",
       c."hora"               AS "horaInicio",
       c."tipo",
       c."nivel",
       c."step",
       COALESCE(c."tituloONivel", c."titulo", c."nombreEvento") AS "tituloEvento",
       c."observaciones"      AS "observacionesEvento",
       c."timeout",
       c."notasadvisor",
       COALESCE(c."sesionCerrada", false) AS "sesionCerrada",
       c."fechaCierreSesion",
       COALESCE(agg."inscritos",  0) AS "inscritos",
       COALESCE(agg."asistieron", 0) AS "asistieron"
     FROM "CALENDARIO" c
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE b."cancelo" IS NOT TRUE) AS "inscritos",
         COUNT(*) FILTER (WHERE b."asistio" = true)      AS "asistieron"
       FROM "ACADEMICA_BOOKINGS" b
       WHERE b."eventoId" = c."_id" OR b."idEvento" = c."_id"
     ) agg ON true
     WHERE c."advisor" = $1
       AND c."dia" >= $2::timestamptz
       AND c."dia" <  $3::timestamptz
     ORDER BY c."dia" ASC, c."hora" ASC`,
    [advisorId, fromISO, toISO],
  );

  const vigentes: VigenteRow[] = vigentesRows.map(r => {
    const fechaEvt = new Date(r.fechaEvento);
    const sesionCerrada = r.sesionCerrada === true;
    const { canEdit, editReason } = computeEditability(fechaEvt, sesionCerrada);
    const inscritos  = Number(r.inscritos ?? 0);
    const asistieron = Number(r.asistieron ?? 0);
    return {
      source: 'CALENDARIO',
      eventoId: r.eventoId,
      fechaEvento: fechaEvt.toISOString(),
      horaInicio: r.horaInicio,
      tipo: r.tipo,
      nivel: r.nivel,
      step: r.step,
      tituloEvento: r.tituloEvento,
      observacionesEvento: r.observacionesEvento,
      timeout: r.timeout,
      notasadvisor: r.notasadvisor,
      sesionCerrada,
      fechaCierreSesion: r.fechaCierreSesion ? new Date(r.fechaCierreSesion).toISOString() : null,
      inscritos,
      asistieron,
      absent: Math.max(0, inscritos - asistieron),
      estado: 'Conducted',
      canEdit,
      editReason,
    };
  });

  const logRows = await AdvisorEventLogRepository.findByAdvisorInRange(advisorId, fromISO, toISO);
  const historicos: HistoricoRow[] = logRows.map((r: AdvisorEventLogRow) => ({
    source: 'LOG',
    logId: r._id,
    eventoId: r.eventoId,
    fechaEvento: new Date(r.fechaEvento).toISOString(),
    horaInicio: r.horaInicio,
    tipo: r.tipo,
    nivel: r.nivel,
    step: r.step,
    tituloEvento: r.tituloEvento,
    timeout: r.horaFin,
    notasadvisor: r.observaciones,
    estado: r.estado,
    canceladoPor: r.canceladoPor,
    fechaTransicion: new Date(r.fechaTransicion).toISOString(),
    motivoTransicion: r.motivoTransicion,
  }));

  return { advisorId, year, month, vigentes, historicos };
}

/**
 * Edita timeout y/o notasadvisor de un evento vigente.
 * Solo el advisor asignado (matcheado por email) puede llamar.
 *
 * Valida:
 *   - Evento existe y advisor lo tiene asignado
 *   - Formato timeout HH:MM militar
 *   - timeout > horaInicio
 *   - Ventana temporal (NOW >= fechaEvento + 30 min)
 *   - sesionCerrada == false
 */
export async function updateAdvisorNotes(
  eventoId: string,
  sessionEmail: string,
  patch: {
    timeout?: string | null;
    notasadvisor?: string | null;
    tz?: string;
    /** Rol de la sesión NextAuth — viene SIEMPRE del route handler, no del body. */
    sessionRole?: string;
    /** Motivo obligatorio cuando un admin edita una sesión ya cerrada. */
    motivoAdminEdit?: string;
  },
): Promise<{ ok: true; timeout: string | null; notasadvisor: string | null; audited: boolean }> {
  const isAdmin = patch.sessionRole === 'SUPER_ADMIN' || patch.sessionRole === 'ADMIN';
  const advisorId = await resolveAdvisorIdByEmail(sessionEmail);

  // ADVISOR (propio): exige email registrado en ADVISORS.
  // ADMIN: no necesita estar en ADVISORS (puede editar evento de cualquiera).
  if (!isAdmin && !advisorId) {
    throw new ForbiddenError('Tu email no está registrado en ADVISORS');
  }

  // CALENDARIO.dia (timestamptz) es la única fuente de verdad para la hora.
  // CALENDARIO.hora (texto) es legacy — en datos históricos quedó guardado
  // como hora UTC en lugar de hora local, por eso NO se usa para validar.
  const tz = patch.tz && TZ_REGEX.test(patch.tz) ? patch.tz : 'America/Bogota';

  const evt = await queryOne<{
    advisor: string;
    dia: Date;
    sesionCerrada: boolean | null;
    horaInicioLocal: string | null;
    timeout: string | null;
    notasadvisor: string | null;
  }>(
    `SELECT "advisor", "dia", "sesionCerrada", "timeout", "notasadvisor",
            TO_CHAR("dia" AT TIME ZONE $2, 'HH24:MI') AS "horaInicioLocal"
     FROM "CALENDARIO" WHERE "_id" = $1`,
    [eventoId, tz],
  );
  if (!evt) throw new NotFoundError('Evento', eventoId);

  const sesionCerrada = evt.sesionCerrada === true;

  if (isAdmin) {
    // Bypass validaciones de ownership / ventana temporal / sesión cerrada.
    // PERO si la sesión está cerrada, exigir motivo (sería edición forzada
    // y queda registro de auditoría).
    if (sesionCerrada && !patch.motivoAdminEdit?.trim()) {
      throw new ValidationError('La sesión está cerrada — debes incluir un motivo obligatorio para editar.');
    }
  } else {
    // ADVISOR: validaciones normales
    if (evt.advisor !== advisorId) {
      throw new ForbiddenError('Este evento está asignado a otro advisor');
    }
    if (sesionCerrada) {
      throw new ValidationError('La sesión ya fue registrada (cerrada). No se puede editar.');
    }
    const { canEdit, editReason } = computeEditability(new Date(evt.dia), false);
    if (!canEdit) throw new ValidationError(editReason ?? 'No se puede editar todavía');
  }

  const updates: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (patch.timeout !== undefined) {
    if (patch.timeout !== null && patch.timeout !== '') {
      if (!TIMEOUT_REGEX.test(patch.timeout)) {
        throw new ValidationError('timeout debe estar en formato HH:MM militar (ej. 09:30, 14:00)');
      }
      if (evt.horaInicioLocal && patch.timeout <= evt.horaInicioLocal) {
        throw new ValidationError(`timeout (${patch.timeout}) debe ser mayor a la hora de inicio (${evt.horaInicioLocal})`);
      }
    }
    updates.push(`"timeout" = $${i++}`);
    params.push(patch.timeout || null);
  }

  if (patch.notasadvisor !== undefined) {
    updates.push(`"notasadvisor" = $${i++}`);
    params.push(patch.notasadvisor || null);
  }

  if (updates.length === 0) {
    throw new ValidationError('Sin campos para actualizar');
  }

  params.push(eventoId);
  const result = await queryOne<{ timeout: string | null; notasadvisor: string | null }>(
    `UPDATE "CALENDARIO" SET ${updates.join(', ')}, "_updatedDate" = NOW()
     WHERE "_id" = $${i}
     RETURNING "timeout", "notasadvisor"`,
    params,
  );

  // Auditoría: solo cuando el editor NO es el advisor propio del evento.
  // Las ediciones del propio advisor en su evento abierto son flujo normal
  // y no se registran (ruido). Las del admin SÍ se registran siempre.
  const shouldAudit = isAdmin && (evt.advisor !== advisorId || sesionCerrada);
  if (shouldAudit) {
    await AdvisorNotesAuditRepository.insert({
      eventoId,
      advisorIdAtEdit: evt.advisor,
      actorEmail: sessionEmail,
      actorRole: patch.sessionRole || 'unknown',
      motivo: patch.motivoAdminEdit?.trim() || '(sin motivo)',
      timeoutBefore: evt.timeout,
      timeoutAfter: result?.timeout ?? null,
      notasBefore: evt.notasadvisor,
      notasAfter: result?.notasadvisor ?? null,
      sesionEstabaCerrada: sesionCerrada,
    }).catch(err => console.warn('[updateAdvisorNotes] audit insert failed:', err?.message));
  }

  return {
    ok: true,
    timeout: result?.timeout ?? null,
    notasadvisor: result?.notasadvisor ?? null,
    audited: shouldAudit,
  };
}

/**
 * Cierra la sesión (botón "Registrar Sesión").
 * Marca sesionCerrada=true. Si notasadvisor está vacío, set "no hubo novedades".
 * Requiere timeout válido previamente guardado.
 */
export async function closeSession(
  eventoId: string,
  sessionEmail: string,
): Promise<{ ok: true; fechaCierreSesion: string; notasadvisor: string }> {
  const advisorId = await resolveAdvisorIdByEmail(sessionEmail);
  if (!advisorId) throw new ForbiddenError('Tu email no está registrado en ADVISORS');

  const evt = await queryOne<{
    advisor: string;
    dia: Date;
    timeout: string | null;
    notasadvisor: string | null;
    sesionCerrada: boolean | null;
  }>(
    `SELECT "advisor", "dia", "timeout", "notasadvisor", "sesionCerrada"
     FROM "CALENDARIO" WHERE "_id" = $1`,
    [eventoId],
  );
  if (!evt) throw new NotFoundError('Evento', eventoId);
  if (evt.advisor !== advisorId) throw new ForbiddenError('Este evento está asignado a otro advisor');
  if (evt.sesionCerrada === true) {
    throw new ValidationError('La sesión ya está cerrada');
  }
  if (!evt.timeout) {
    throw new ValidationError('Debes registrar la hora de fin (Time Out) antes de cerrar la sesión');
  }

  const { canEdit } = computeEditability(new Date(evt.dia), false);
  if (!canEdit) throw new ValidationError('La sesión no puede cerrarse aún');

  const notas = (evt.notasadvisor && evt.notasadvisor.trim().length > 0)
    ? evt.notasadvisor
    : 'no hubo novedades';

  const result = await queryOne<{ fechaCierreSesion: Date; notasadvisor: string }>(
    `UPDATE "CALENDARIO"
     SET "sesionCerrada" = true,
         "fechaCierreSesion" = NOW(),
         "notasadvisor" = $2,
         "_updatedDate" = NOW()
     WHERE "_id" = $1
     RETURNING "fechaCierreSesion", "notasadvisor"`,
    [eventoId, notas],
  );

  return {
    ok: true,
    fechaCierreSesion: result!.fechaCierreSesion.toISOString(),
    notasadvisor: result!.notasadvisor,
  };
}

/**
 * Lee el flag global APP_CONFIG.sesion_requiere_registro.
 * Default 'true' si no existe.
 */
export async function isRegistroSesionRequerido(): Promise<boolean> {
  const row = await queryOne<{ value: string }>(
    `SELECT "value" FROM "APP_CONFIG" WHERE "key" = 'sesion_requiere_registro'`,
  );
  return (row?.value ?? 'true').toLowerCase() === 'true';
}
