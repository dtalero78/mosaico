import 'server-only';
import { queryOne } from '@/lib/postgres';
import { ValidationError, NotFoundError, ForbiddenError } from '@/lib/errors';
import { getSessionWindow, EXPIRED_MESSAGE, ATTENDANCE_OPEN_MIN } from '@/lib/session-window';
import { estaAutorizado } from '@/services/autorizacion-gestion.service';
import { guiaIdDeSesion } from '@/services/guia-sesion.service';
import { tienePermiso } from '@/lib/api-permissions';
import { StudentPermission, AcademicoPermission } from '@/types/permissions';

const BYPASS = ['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN'];

/**
 * Barrera común para TODA ruta que escribe asistencia de un agendamiento
 * (individual, masiva y modal de la ficha). Misma regla que `academic-record`:
 *  - Quién: Coordinación/Admin, el guía del evento, o un rol con permiso de
 *    evaluar (modal de la ficha / ir a la sesión).
 *  - Cuándo: desde +15 min del inicio hasta +24 h; vencida sólo con la
 *    autorización de Coordinación para el guía del evento.
 *  - Sesión cerrada: sólo Coordinación/Admin.
 * Eventos que no están en CALENDARIO (datos legacy) no se bloquean por tiempo.
 */
export async function assertPuedeMarcarAsistencia(session: any, bookingId: string): Promise<void> {
  const role = String(session?.user?.role || '').toUpperCase();
  const email = session?.user?.email;
  // Sin ventana ni bloqueo por sesión cerrada: Coordinación/Admin o quien tenga el permiso.
  const esAdmin = BYPASS.includes(role) || await tienePermiso(session, AcademicoPermission.ASISTENCIA_CORREGIR);

  const b = await queryOne<{ dia: Date | null; advisor: string | null; cerrada: boolean | null }>(
    `SELECT c."dia", c."advisor", c."sesionCerrada" AS "cerrada", c."_id" AS "eventoId"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
      WHERE b."_id" = $1 LIMIT 1`,
    [bookingId],
  );
  if (!b) throw new NotFoundError('Booking', bookingId);

  const guiaId = await guiaIdDeSesion(email);
  const esGuiaDelEvento = !!guiaId && guiaId === b.advisor;
  if (!esAdmin && !esGuiaDelEvento) {
    const ok = (await tienePermiso(session, StudentPermission.EVALUACION))
      || (await tienePermiso(session, AcademicoPermission.IR_A_SESION));
    if (!ok) throw new ForbiddenError('No tienes permiso para marcar asistencia');
  }

  if (b.cerrada === true && !esAdmin) {
    throw new ValidationError('La sesión ya está cerrada: sólo un administrador puede modificar la asistencia.');
  }
  if (!b.dia) return;

  let ws = getSessionWindow(b.dia, esAdmin ? 'COORDINADOR_ACADEMICO' : role, new Date());
  if (!ws.canMarkAttendance && ws.isExpired && esGuiaDelEvento) {
    const { queryOne: q } = await import('@/lib/postgres');
    const ev = await q<{ id: string }>(
      `SELECT c."_id" AS id FROM "ACADEMICA_BOOKINGS" b LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento") WHERE b."_id" = $1`,
      [bookingId],
    );
    if (ev?.id && await estaAutorizado('SESION', ev.id)) ws = getSessionWindow(b.dia, esAdmin ? 'COORDINADOR_ACADEMICO' : role, new Date(), true);
  }
  if (!ws.canMarkAttendance) {
    if (ws.isExpired) throw new ValidationError(EXPIRED_MESSAGE);
    throw new ValidationError(
      ws.minutesElapsed < ATTENDANCE_OPEN_MIN
        ? 'La asistencia sólo se puede modificar desde 15 minutos después del inicio del evento.'
        : 'Fuera de la ventana de registro de asistencia.',
    );
  }
}
