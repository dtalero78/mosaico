import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { autorizarRepetir, rechazarRepetir } from '@/services/repetir-clase.service';

/**
 * POST /api/postgres/reports/academico/solicitud-sesiones/autorizar
 *   { eventoId, autorizar: boolean, comentario? }
 *
 * autorizar=true  → registra en historicRepet, extiende el curso por semanas si
 *                   faltan sesiones (crea eventos + bookings para los usuarios del
 *                   salón), re-mapea la secuencia y marca el evento autorizado.
 * autorizar=false → rechaza (repetClass −1, anula la marca, no toca finalCurso).
 * Gateado por ACADEMICO.SOLICITUD_SESIONES.GESTION.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SOLICITUD_SESIONES_GESTION);
  const email = (session?.user as any)?.email || 'desconocido';
  const body = await request.json();
  const eventoId = String(body?.eventoId || '').trim();
  if (!eventoId) throw new ValidationError('eventoId es requerido.');

  if (body?.autorizar === false) {
    const r = await rechazarRepetir(eventoId);
    return successResponse({ ...r, autorizada: false });
  }

  const r = await autorizarRepetir(eventoId, String(body?.comentario || '').trim(), email);
  return successResponse({ ...r, autorizada: true });
});
