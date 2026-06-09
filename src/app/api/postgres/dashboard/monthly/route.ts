import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getMonthlyAggregates } from '@/services/dashboard.service';

/**
 * GET /api/postgres/dashboard/monthly?tz=America/Bogota
 *
 * Agregaciones globales del mes corriente para el dashboard admin:
 * donut (asistieron/canceladas/noAsistieron) y porNivel (bookings por
 * nivel). Sólo bookings con evento en el mes actual. El heatmap se eliminó
 * el 2026-06-09 — el `tz` query param se ignora ahora pero se conserva
 * para no romper requests cacheados de la versión anterior.
 *
 * Acceso: cualquier usuario autenticado (el dashboard principal ya filtra
 * por rol en /page.tsx — ADVISOR ve su propio dashboard, no este).
 */
const TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+)?$/;

export const GET = handlerWithAuth(async (request) => {
  const url = new URL(request.url);
  const tzParam = url.searchParams.get('tz');
  const tz = tzParam && TZ_REGEX.test(tzParam) ? tzParam : 'America/Bogota';
  const data = await getMonthlyAggregates(tz);
  return successResponse(data);
});
