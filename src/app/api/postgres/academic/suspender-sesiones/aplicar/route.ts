import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { suspender, reactivar } from '@/services/suspender-sesiones.service';

/**
 * POST /api/postgres/academic/suspender-sesiones/aplicar
 *
 * Suspender:  { items: [{cursoCampaignId, fecha}], motivo }
 * Reactivar:  { reactivar: { cursoCampaignId, fecha } }
 *
 * Acción MASIVA: suspender una fecha afecta a todos los alumnos del salón (la
 * sesión se corre al final del curso). Gateado por
 * ACADEMICO.SUSPENDER_SESIONES.GESTION. El actor sale de la sesión (no del body).
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SUSPENDER_SESIONES_GESTION);
  const body = await request.json();

  const actor = {
    email: session.user?.email || null,
    nombre: (session.user as any)?.name || null,
  };

  if (body?.reactivar) {
    const cambio = await reactivar(body.reactivar.cursoCampaignId, body.reactivar.fecha);
    return successResponse({ reactivado: true, cambios: [cambio] });
  }

  const cambios = await suspender(body?.items || [], body?.motivo || '', actor);
  return successResponse({ cambios });
});
