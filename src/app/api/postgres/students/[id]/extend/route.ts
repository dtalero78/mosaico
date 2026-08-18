import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { StudentPermission } from '@/types/permissions';
import { extendByDays } from '@/services/contract.service';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/postgres/students/[id]/extend
 *
 * Extend student's contract vigencia (finalContrato)
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, StudentPermission.EXTENDER_VIGENCIA);
  const body = await request.json();
  const { diasExtension, motivo } = body;

  if (!diasExtension || diasExtension <= 0) {
    throw new ValidationError('diasExtension must be a positive number');
  }
  if (!motivo || motivo.trim() === '') {
    throw new ValidationError('motivo is required');
  }

  const result = await extendByDays({
    studentId: params.id,
    diasExtension,
    motivo: motivo.trim(),
    ejecutadoPor: session.user?.name || 'System',
    ejecutadoPorEmail: session.user?.email || 'system@lgs.com',
  });

  return successResponse({
    message: `Vigencia extendida ${diasExtension} días exitosamente`,
    student: result.student,
    extension: result.extension,
  });
});
