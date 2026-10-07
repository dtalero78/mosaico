/**
 * GET /api/admin/envio-mensajes/eventos?fecha=YYYY-MM-DD&tipo=&tz=
 *   → los eventos de ese día (en la zona del navegador), del tipo pedido o todos.
 * GET /api/admin/envio-mensajes/eventos?eventoId=&tz=
 *   → un evento suelto, para abrir la pantalla con él ya elegido (botón
 *     "Enviar mensaje a inscritos" del calendario).
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { eventosDelDia, eventoPorId } from '@/services/envio-evento.service';

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.ENVIO_MENSAJES);
  const sp = new URL(request.url).searchParams;
  const tz = sp.get('tz');

  const eventoId = (sp.get('eventoId') || '').trim();
  if (eventoId) return successResponse({ evento: await eventoPorId(eventoId, tz) });

  const fecha = (sp.get('fecha') || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidationError('Elige una fecha válida');
  const tipo = (sp.get('tipo') || '').trim();
  return successResponse({ eventos: await eventosDelDia(fecha, tipo, tz) });
});
