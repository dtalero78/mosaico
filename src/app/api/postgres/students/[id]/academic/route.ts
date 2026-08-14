import { handler, successResponse } from '@/lib/api-helpers';
import { getAcademicHistory } from '@/services/student.service';
import { ValidationError } from '@/lib/errors';

/**
 * GET /api/postgres/students/[id]/academic
 *
 * Get student academic record + class history
 */
export const GET = handler(async (request, { params }) => {
  if (!params.id) throw new ValidationError('Student ID is required');

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '100');
  // ?futuras=1 incluye las clases de semanas futuras (ocultas por defecto).
  const incluirFuturas = searchParams.get('futuras') === '1';

  const data = await getAcademicHistory(params.id, limit, incluirFuturas);

  return successResponse({ data });
});
