import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { moraService } from '@/services/mora.service';

/** GET /api/postgres/recaudos/usuarios-mora/[contrato] → beneficiarios del contrato. */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, RecaudosPermission.USUARIOS_MORA_VER as any);
  const beneficiarios = await moraService.beneficiarios(decodeURIComponent(params.contrato));
  return successResponse({ beneficiarios });
});
