import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { RolPermisosRepository } from '@/repositories/roles.repository';
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
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';

  // Acceso a Ctrl Horas de CUALQUIER advisor: SUPER_ADMIN/ADMIN o roles con
  // el permiso ACADEMICO.CONTROL_HORAS.VER_TODOS. El resto sólo puede
  // consultar su propio Ctrl Horas (email matchea el ADVISORS._id del path).
  if (!isAdmin) {
    // Leer permisos del rol DIRECTO de ROL_PERMISOS (fuente de verdad), no
    // vía getPermissionsByRole() que hace un self-fetch HTTP y cae a un
    // FALLBACK_PERMISSIONS_MAP hardcodeado cuando el fetch falla — ese
    // fallback no refleja permisos asignados recientemente en /admin/permissions.
    let canPickAdvisor = false;
    try {
      const row = await RolPermisosRepository.findByRol(role);
      const perms = Array.isArray((row as any)?.permisos) ? (row as any).permisos as string[] : [];
      canPickAdvisor = perms.includes('ACADEMICO.CONTROL_HORAS.VER_TODOS');
    } catch { /* sin permisos → tratado como advisor propio */ }

    if (!canPickAdvisor) {
      const adv = await queryOne<{ _id: string }>(
        `SELECT "_id" FROM "GUIAS" WHERE LOWER("email") = LOWER($1)`,
        [email],
      );
      if (!adv || adv._id !== params.id) {
        throw new ForbiddenError('Solo puedes consultar tu propio Ctrl Horas');
      }
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
