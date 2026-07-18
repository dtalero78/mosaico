import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getCampaniasResumen } from '@/services/dashboard.service';

/**
 * GET /api/postgres/dashboard/campanias?tz=America/Bogota
 *
 * Resumen para el dashboard admin: campañas por estado (en matrícula / activas /
 * cerradas) con sus inscritos, usuarios activos/inactivos, y cursos activos por
 * tipo. Estado de campaña con el mismo criterio que Consulta de Cursos.
 *
 * Acceso: cualquier usuario autenticado (el dashboard ya filtra por rol en
 * /page.tsx — ADVISOR ve su propio panel, no este).
 */
const TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+)?$/;

export const GET = handlerWithAuth(async (request) => {
  const url = new URL(request.url);
  const tzParam = url.searchParams.get('tz');
  const tz = tzParam && TZ_REGEX.test(tzParam) ? tzParam : 'America/Bogota';
  const data = await getCampaniasResumen(tz);
  return successResponse(data);
});
