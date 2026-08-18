import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { StudentPermission } from '@/types/permissions';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { StepOverridesRepository } from '@/repositories/niveles.repository';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';

/**
 * Resolves the canonical ACADEMICA _id for a student.
 * Throws ConflictError if the student has duplicate records in ACADEMICA.
 * Throws NotFoundError if not found.
 */
async function resolveAcademicaId(paramsId: string): Promise<{ academicaId: string; nivel: string }> {
  const record = await AcademicaRepository.findByAnyId(paramsId);
  if (!record) throw new NotFoundError('Registro académico', paramsId);

  if (record.numeroId) {
    const duplicates = await AcademicaRepository.findManyByNumeroId(record.numeroId);
    if (duplicates.length > 1) {
      throw new ConflictError(`USUARIO duplicado en ACADEMICA (${duplicates.length} registros con numeroId ${record.numeroId})`);
    }
  }

  return { academicaId: record._id, nivel: record.nivel || '' };
}

/**
 * POST /api/postgres/students/[id]/step-override
 *
 * Establece o cambia un override de step con auditoría obligatoria.
 *
 * Body:
 *   - step: "Step 3" (requerido)
 *   - completado: true | false | null  (requerido — null = quitar override / soft-delete)
 *   - motivo: string (requerido, no vacío)
 *   - nivel: string (opcional — se resuelve desde ACADEMICA si no viene)
 *
 * Cada cambio agrega una entry a STEP_OVERRIDES.notaoverrideHistory con:
 *   { fecha, accion, isCompletedBefore, isCompletedAfter, motivo, realizadoPor, realizadoPorNombre }
 *
 * realizadoPor / realizadoPorNombre se toman de la sesión (NextAuth) — no
 * spoofeables desde el body.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, StudentPermission.MARCAR_STEP);
  const body = await request.json();
  const { step, completado, motivo, nivel: nivelFromBody } = body;

  if (!step) throw new ValidationError('step is required');
  if (completado !== true && completado !== false && completado !== null) {
    throw new ValidationError('completado debe ser true, false o null');
  }
  if (typeof motivo !== 'string' || !motivo.trim()) {
    throw new ValidationError('motivo es obligatorio');
  }

  const { academicaId, nivel } = await resolveAcademicaId(params.id);
  const realizadoPor = (session?.user as any)?.email ?? '';
  const realizadoPorNombre = (session?.user as any)?.name ?? undefined;

  const override = await StepOverridesRepository.upsertWithHistory({
    _id: ids.override(),
    studentId: academicaId,
    nivel: nivel || nivelFromBody || '',
    step,
    isCompleted: completado,
    motivo: motivo.trim(),
    realizadoPor,
    realizadoPorNombre,
  });

  if (!override) {
    // pidieron quitar (completado=null) pero no había override previo: nada que hacer
    return successResponse({ message: `No había override activo para ${step}`, override: null });
  }

  const accion = completado === true ? 'marcado como completo' :
                 completado === false ? 'marcado como incompleto' :
                                        'quitado';
  return successResponse({ message: `Override ${accion} para ${step}`, override });
});

/**
 * DELETE /api/postgres/students/[id]/step-override?step=X&motivo=Y
 *
 * Soft-delete del override (isCompleted=NULL + history). Es alias de
 * POST con completado=null. motivo obligatorio (querystring).
 */
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, StudentPermission.MARCAR_STEP);
  const { searchParams } = new URL(request.url);
  const step = searchParams.get('step');
  const motivo = (searchParams.get('motivo') || '').trim();

  if (!step) throw new ValidationError('step query parameter is required');
  if (!motivo) throw new ValidationError('motivo query parameter es obligatorio');

  const { academicaId, nivel } = await resolveAcademicaId(params.id);
  const realizadoPor = (session?.user as any)?.email ?? '';
  const realizadoPorNombre = (session?.user as any)?.name ?? undefined;

  const override = await StepOverridesRepository.upsertWithHistory({
    _id: ids.override(),
    studentId: academicaId,
    nivel,
    step,
    isCompleted: null,
    motivo,
    realizadoPor,
    realizadoPorNombre,
  });

  if (!override) throw new NotFoundError('Override activo', `${params.id}/${step}`);
  return successResponse({ message: `Override quitado para ${step}`, override });
});

/**
 * GET /api/postgres/students/[id]/step-override
 *
 * Devuelve overrides ACTIVOS por defecto. Con ?withHistory=1 devuelve también
 * los soft-deleted (para visor de historial).
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const { searchParams } = new URL(request.url);
  const step = searchParams.get('step');
  const withHistory = searchParams.get('withHistory') === '1';

  const { academicaId } = await resolveAcademicaId(params.id);

  if (step) {
    const override = await StepOverridesRepository.findByStudentAndStep(academicaId, step);
    return successResponse({ overrides: override ? [override] : [], count: override ? 1 : 0 });
  }

  const overrides = withHistory
    ? await StepOverridesRepository.findAllByStudentId(academicaId)
    : await StepOverridesRepository.findByStudentId(academicaId);
  return successResponse({ overrides, count: overrides.length });
});
