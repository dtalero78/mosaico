import { handler, successResponse } from '@/lib/api-helpers';
import { AdvisorRepository } from '@/repositories/advisor.repository';

/**
 * GET /api/postgres/guias
 *
 * Lista de guías (tabla GUIAS). Con ?advisorId= devuelve un guía puntual.
 * La respuesta incluye las claves `guias`, `advisors` y `data` (mismo array)
 * por compatibilidad con todos los llamadores (dropdowns de Campañas/Consulta
 * Cursos leen `guias`; selector del Panel Guía / AdvisorDashboard leen
 * `advisors`/`data`).
 */
export const GET = handler(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const advisorId = searchParams.get('advisorId');

  if (advisorId) {
    const advisor = await AdvisorRepository.findByIdOrEmail(advisorId);
    return successResponse({ advisor, guia: advisor });
  }

  const includeInactive = searchParams.get('includeInactive') === 'true';
  const list = await AdvisorRepository.findAll(includeInactive);

  return successResponse({ guias: list, advisors: list, data: list, total: list.length });
});

/**
 * POST /api/postgres/guias (compatibilidad frontend)
 */
export const POST = handler(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const includeInactive = body.includeInactive === true;
  const list = await AdvisorRepository.findAll(includeInactive);

  return successResponse({ guias: list, advisors: list, data: list, total: list.length });
});
