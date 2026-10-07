/**
 * POST /api/admin/envio-mensajes/lookup-evento
 * Body: { eventoId, asistencia?: 'todos' | 'asistieron' | 'no-asistieron' }
 *
 * Los inscritos (no cancelados) de UN evento, en el mismo formato que
 * `lookup-apoderados`, para reusar la lista, la vista previa y `/send`.
 * El teléfono de destino lo resuelve el servidor: apoderado en los cursos que lo
 * usan, alumno en los demás (ver services/envio-evento).
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { destinatariosDeEvento, type FiltroAsistencia } from '@/services/envio-evento.service';

const FILTROS: FiltroAsistencia[] = ['todos', 'asistieron', 'no-asistieron'];

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.ENVIO_MENSAJES);
  const body = await request.json().catch(() => ({}));
  const eventoId = String(body?.eventoId || '').trim();
  if (!eventoId) throw new ValidationError('Elige un evento');
  const asistencia = (FILTROS.includes(body?.asistencia) ? body.asistencia : 'todos') as FiltroAsistencia;
  return successResponse(await destinatariosDeEvento(eventoId, asistencia));
});
