import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { listarMigracion } from '@/services/migracion-aprobacion.service';

/**
 * GET /api/postgres/approvals/migracion
 *
 * Contratos migrados sin aprobar (pestaña «Migración» del Centro de
 * Aprobaciones), sin los de la campaña en matrícula ni la inmediatamente
 * anterior. Devuelve además cuáles son esas campañas y cuántos contratos se
 * dejaron fuera por ellas, para decirlo en pantalla.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.MIGRACION_APROBAR);
  return successResponse(await listarMigracion());
});
