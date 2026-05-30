/**
 * GET /api/postgres/reports/academico/performance-evaluation
 *   ?startDate&endDate&advisorId&nivel&tipo&plataforma
 *
 * Stats agregadas para el dashboard de Performance Evaluation.
 * Gateado por ACADEMICO.PERFORMANCE_EVAL.VER (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { getDashboardStats } from '@/services/evaluations.service';

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.PERFORMANCE_EVAL_VER);

  const { searchParams } = new URL(req.url);
  const stats = await getDashboardStats({
    startDate: searchParams.get('startDate'),
    endDate:   searchParams.get('endDate'),
    advisorId: searchParams.get('advisorId'),
    nivel:     searchParams.get('nivel'),
    tipo:      searchParams.get('tipo'),
    plataforma: searchParams.get('plataforma'),
  });
  return successResponse(stats);
});
