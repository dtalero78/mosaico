import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { buildMonthlyView, isRegistroSesionRequerido } from '@/services/advisor-event-log.service';

/**
 * GET /api/postgres/advisors/[id]/control-horas?year=YYYY&month=MM
 *
 * Devuelve la vista mensual de Ctrl Horas para un advisor:
 *   { vigentes: [...], historicos: [...], requiereRegistro: boolean }
 *
 * Acceso: el advisor propio (matcheado por email) o ADMIN/SUPER_ADMIN.
 */
export const GET = handlerWithAuth(async (request, { params }, session) => {
  const role  = (session?.user as any)?.role;
  const email = (session?.user as any)?.email || '';

  // Advisor propio: validar que su email matchee el ADVISORS._id del path
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    const adv = await queryOne<{ _id: string }>(
      `SELECT "_id" FROM "ADVISORS" WHERE LOWER("email") = LOWER($1)`,
      [email],
    );
    if (!adv || adv._id !== params.id) {
      throw new ForbiddenError('Solo puedes consultar tu propio Ctrl Horas');
    }
  }

  const url = new URL(request.url);
  const year  = parseInt(url.searchParams.get('year')  || '', 10);
  const month = parseInt(url.searchParams.get('month') || '', 10);
  if (!year || !month || month < 1 || month > 12) {
    throw new ValidationError('year y month son requeridos (month 1-12)');
  }

  const view = await buildMonthlyView(params.id, year, month);
  const requiereRegistro = await isRegistroSesionRequerido();
  return successResponse({ ...view, requiereRegistro });
});
