import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getInicializarNivelInfo, inicializarNivel } from '@/services/student.service';

/**
 * GET /api/postgres/students/[id]/inicializar-nivel
 * Returns eligibility, current nivel/step, first step of nivel, and booking count.
 * Access controlled by frontend (STUDENT.ACADEMIA.INICIALIZAR_NIVEL permission via usePermissions).
 */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  const info = await getInicializarNivelInfo(params.id);
  return successResponse(info);
});

/**
 * POST /api/postgres/students/[id]/inicializar-nivel
 * Executes the nivel reset. One-time-only per student.
 */
export const POST = handlerWithAuth(async (req, { params }, session) => {
  const { motivo, autorizadoPor } = await req.json();
  const realizadoPor = (session.user as any).name || session.user?.email || 'Sistema';

  const result = await inicializarNivel(params.id, motivo, autorizadoPor, realizadoPor);
  return successResponse(result);
});
