import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { StudentPermission } from '@/types/permissions';
import { listarReactivadosSinSalon } from '@/services/contract.service';

/**
 * GET /api/postgres/students/onhold/sin-salon
 *
 * Alumnos que salieron del OnHold sin salón (lo soltaron al pausarse). Mismo
 * permiso que pausar/reactivar: quien decide el regreso decide a qué salón.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, StudentPermission.ACTIVAR_HOLD);
  const rows = await listarReactivadosSinSalon();
  return successResponse({ rows, count: rows.length });
});
