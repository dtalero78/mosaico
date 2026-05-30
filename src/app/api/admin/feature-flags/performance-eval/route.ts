/**
 * GET  /api/admin/feature-flags/performance-eval
 * POST /api/admin/feature-flags/performance-eval { mode, betaUsers[] }
 *
 * Gestiona el feature flag global de Performance Evaluation.
 * Solo SUPER_ADMIN (Role.SUPER_ADMIN). El permiso bypass del catálogo no
 * aplica acá: es una palanca crítica de feature, manual y restringida.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { getFeatureFlag, updateFeatureFlag } from '@/services/evaluations.service';
import { Role } from '@/types/permissions';

function assertSuperAdmin(session: any) {
  const role = session?.user?.role;
  if (role !== Role.SUPER_ADMIN && role !== Role.ADMIN) {
    throw new ForbiddenError('Solo SUPER_ADMIN/ADMIN puede modificar este feature flag');
  }
}

export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  assertSuperAdmin(session);
  const flag = await getFeatureFlag();
  return successResponse(flag);
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  assertSuperAdmin(session);
  const body = await request.json();
  const mode = body?.mode;
  const betaUsers = body?.betaUsers ?? [];
  if (!['off','beta','on'].includes(mode)) throw new ValidationError('mode debe ser off | beta | on');
  if (!Array.isArray(betaUsers)) throw new ValidationError('betaUsers debe ser array');
  const updated = await updateFeatureFlag({ mode, betaUsers });
  return successResponse(updated);
});
