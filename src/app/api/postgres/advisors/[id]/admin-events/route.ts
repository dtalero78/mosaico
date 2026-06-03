/**
 * GET /api/postgres/advisors/[id]/admin-events?year=&month=
 *
 * Lista de eventos administrativos de UN advisor en un mes específico.
 * Usado por:
 *   - Panel Advisor (calendario mensual — pinta admin events)
 *   - Control de Horas (cálculo de tarjeta Administrative Hours)
 *   - AdvisorDashboard (mismo cálculo)
 *
 * Validación de acceso:
 *   - Coordinator / admin / VER_TODOS → puede ver cualquiera
 *   - Otros (advisor) → solo si su email matchea con ADVISORS._id == params.id
 *
 * Devuelve también el agregado de horas para evitar otra query.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError, ForbiddenError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import {
  listAdminEventsForAdvisorMonth,
  getAdminEventHoursAggregate,
} from '@/services/admin-events.service';

const BYPASS_ROLES = new Set(['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN']);

export const GET = handlerWithAuth(async (request, { params }, session) => {
  const advisorId = params.id;
  const { searchParams } = new URL(request.url);
  const year  = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new ValidationError('year (YYYY) y month (1-12) requeridos');
  }

  const email = (session?.user as any)?.email;
  const role  = String((session?.user as any)?.role || '').toUpperCase();

  // Coordinator/admin pueden ver cualquier advisor. El advisor solo el suyo.
  if (!BYPASS_ROLES.has(role)) {
    const adv = await queryOne<{ _id: string }>(
      `SELECT "_id" FROM "ADVISORS" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
      [email],
    );
    if (!adv?._id) throw new ForbiddenError('Tu email no está registrado en ADVISORS');
    if (adv._id !== advisorId) throw new ForbiddenError('No puedes ver admin events de otro advisor');
  }

  const [items, aggregate] = await Promise.all([
    listAdminEventsForAdvisorMonth(advisorId, year, month),
    getAdminEventHoursAggregate(advisorId, year, month),
  ]);
  return successResponse({ items, total: items.length, aggregate });
});
