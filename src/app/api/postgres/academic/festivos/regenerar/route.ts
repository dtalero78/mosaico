import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { regenerarCursosDeFechas } from '@/services/festivos-personalizados.service';

/**
 * POST /api/postgres/academic/festivos/regenerar — body { fechas: ['YYYY-MM-DD', ...] }
 *
 * Recoloca las clases de los cursos que tenían sesión esos días. Declarar un
 * festivo no mueve los eventos ya creados; esto es el paso que los mueve.
 * Preserva la asistencia ya marcada (`regenerarCursoPreservandoEstado`).
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const body = await request.json().catch(() => ({}));
  const fechas: string[] = Array.isArray(body?.fechas) ? body.fechas : [];
  if (!fechas.length) throw new ValidationError('Indica al menos una fecha a regenerar.');
  if (fechas.length > 40) throw new ValidationError('Máximo 40 fechas por operación.');
  const resultados = await regenerarCursosDeFechas(fechas);
  return successResponse({
    resultados,
    cursos: resultados.length,
    fallidos: resultados.filter((r) => r.error).length,
  });
});
