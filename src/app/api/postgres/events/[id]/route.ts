import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { getEventById, updateEvent, deleteEvent } from '@/services/calendar.service';
import { estaAutorizado } from '@/services/autorizacion-gestion.service';
import { actualizarGraduacion } from '@/services/graduacion.service';
import { ForbiddenError } from '@/lib/errors';

/**
 * GET /api/postgres/events/[id]
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const event: any = await getEventById(params.id);
  // ¿Coordinación autorizó al guía a registrar esta sesión fuera de plazo? El
  // panel de la sesión lo usa para reabrir los controles; el servidor lo vuelve
  // a comprobar al guardar. Sólo se consulta mientras siga sin registrar.
  const autorizadoGestion = event?.sesionCerrada === true ? false : await estaAutorizado('SESION', params.id);
  return successResponse({ event: { ...event, autorizadoGestion } });
});

/**
 * PUT /api/postgres/events/[id]
 *
 * Body puede incluir 2 metas:
 *   - `_motivoCambioAdvisor` — texto que se guarda en
 *     ADVISOR_EVENT_LOG.motivoTransicion cuando cambia el advisor.
 *   - `_skipLog: true` — modo "Restructuración" para cambio de advisor:
 *     el cambio se aplica pero NO inserta entrada Canceled en
 *     ADVISOR_EVENT_LOG (cuando es un fix de planificación, no una
 *     cancelación real del advisor original).
 *
 * Ambos campos se quitan del body antes de enviarlo al service (no son
 * columnas de CALENDARIO).
 */
export const PUT = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.EDITAR);
  const body = await request.json();
  const motivo = typeof body?._motivoCambioAdvisor === 'string' ? body._motivoCambioAdvisor : undefined;
  const skipLog = body?._skipLog === true;
  delete body._motivoCambioAdvisor;
  delete body._skipLog;

  const actor = (session?.user as any)?.email || 'system';

  // GRADUACIÓN: su propia edición (alcance de cursos/salones, alumnos convocados y
  // tipo inmutable). Cualquier otro tipo sigue el camino de siempre.
  const actual: any = await getEventById(params.id);
  if (String(actual?.tipo || actual?.evento || '').toUpperCase() === 'GRADUACION') {
    const resumen = await actualizarGraduacion(params.id, body, {
      actor, motivo, skipLog,
      nombre: session?.user?.name || undefined,
      rol: (session?.user as any)?.role,
    });
    const event = await getEventById(params.id);
    return successResponse({ event, graduacion: resumen });
  }

  const event = await updateEvent(params.id, body, { actor, motivo, skipLog });
  return successResponse({ event });
});

/**
 * DELETE /api/postgres/events/[id]
 *
 * Querystring opcionales:
 *   - `motivo`           — texto que se guarda en ADVISOR_EVENT_LOG.motivoTransicion
 *   - `skipLog=true`     — modo "Restructuración": NO inserta en
 *                          ADVISOR_EVENT_LOG (borrado limpio, sin huella en
 *                          Ctrl Horas del advisor).
 *   - `deleteBookings`   — `false` para NO borrar los agendamientos. Por defecto
 *                          SÍ se borran: dejarlos apuntando a un evento que ya no
 *                          existe los vuelve invisibles para el alumno y para el
 *                          guía, y es la vía por la que aparecían huérfanos. Si
 *                          alguno tiene asistencia registrada el borrado se
 *                          rechaza entero (ver `deleteEvent`).
 *   - `deleteGroup=true` — si el evento es compartido (eventoCompartidoId),
 *                          borra también todos sus hermanos del grupo en una
 *                          sola transacción. Sin esta flag, sólo borra el
 *                          evento solicitado y los hermanos quedan vivos.
 */
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.ELIMINAR);
  const { searchParams } = new URL(request.url);
  // Ojo: por defecto TRUE. Antes era `=== 'true'`, y como la interfaz nunca manda
  // el parámetro, cada borrado de evento dejaba sus agendamientos huérfanos.
  const deleteBookings = searchParams.get('deleteBookings') !== 'false';
  const motivo = searchParams.get('motivo') || undefined;
  const skipLog = searchParams.get('skipLog') === 'true';
  const deleteGroup = searchParams.get('deleteGroup') === 'true';
  const actor = (session?.user as any)?.email || 'system';

  // Una graduación sólo la elimina Coordinación Académica o un administrador.
  const actual: any = await getEventById(params.id);
  if (String(actual?.tipo || actual?.evento || '').toUpperCase() === 'GRADUACION') {
    const rol = String((session?.user as any)?.role || '').toUpperCase();
    if (!['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN'].includes(rol)) {
      throw new ForbiddenError('Una graduación sólo la puede eliminar Coordinación Académica o un administrador.');
    }
  }

  const result = await deleteEvent(params.id, deleteBookings, { actor, motivo, skipLog, deleteGroup });

  return successResponse({
    message: 'Evento eliminado exitosamente',
    eventId: params.id,
    bookingsDeleted: result.bookingsDeleted,
    eventsDeleted: result.eventsDeleted,
    skipLog,
    deleteGroup,
  });
});
