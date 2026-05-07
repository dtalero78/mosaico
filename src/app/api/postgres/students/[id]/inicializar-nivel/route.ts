import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError } from '@/lib/errors';
import { StudentPermission } from '@/types/permissions';
import { getInicializarNivelInfo, inicializarNivel } from '@/services/student.service';

/**
 * GET /api/postgres/students/[id]/inicializar-nivel
 * Returns eligibility, current nivel/step, first step of nivel, and booking count.
 */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  const perms: string[] = (session.user as any).permissions || [];
  const role: string = (session.user as any).role || '';
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  if (!isAdmin && !perms.includes(StudentPermission.INICIALIZAR_NIVEL)) {
    throw new ForbiddenError('No tienes permiso para esta acción');
  }

  const info = await getInicializarNivelInfo(params.id);
  return successResponse(info);
});

/**
 * POST /api/postgres/students/[id]/inicializar-nivel
 * Executes the nivel reset. One-time-only per student.
 */
export const POST = handlerWithAuth(async (req, { params }, session) => {
  const perms: string[] = (session.user as any).permissions || [];
  const role: string = (session.user as any).role || '';
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  if (!isAdmin && !perms.includes(StudentPermission.INICIALIZAR_NIVEL)) {
    throw new ForbiddenError('No tienes permiso para esta acción');
  }

  const { motivo, autorizadoPor } = await req.json();
  const realizadoPor = (session.user as any).name || session.user?.email || 'Sistema';

  const result = await inicializarNivel(params.id, motivo, autorizadoPor, realizadoPor);
  return successResponse(result);
});
