import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { UsuariosRolesRepository } from '@/repositories/roles.repository';
import { NotFoundError } from '@/lib/errors';

/**
 * GET /api/postgres/guias/[id]/name
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const advisorId = decodeURIComponent(params.id);
  const advisor = await UsuariosRolesRepository.findByEmail(advisorId);

  if (!advisor || !advisor.activo) throw new NotFoundError('Advisor', advisorId);

  return successResponse({
    advisorId: advisor.email,
    email: advisor.email,
    rol: advisor.rol,
    name: advisor.email,
  });
});
