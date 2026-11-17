import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getReporteDelEstudiante } from '@/services/reporte-estudiante.service';

/**
 * GET /api/postgres/panel-estudiante/reporte-academico?semana=YYYY-MM-DD
 * Reporte académico del estudiante logueado (una de las dos últimas semanas
 * completas) en HTML, para verlo por pantalla.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  const semana = new URL(request.url).searchParams.get('semana') || undefined;
  const { clavePdf: _clave, ...reporte } = await getReporteDelEstudiante(session, semana);
  return successResponse({ reporte });
});
