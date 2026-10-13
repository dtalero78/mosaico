import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { StudentPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { listarReactivadosSinSalon } from '@/services/contract.service';
import { cambiarCursoAcademico } from '@/services/cambio-academico.service';

/**
 * POST /api/postgres/students/onhold/asignar-salon
 * Body: { academicaId, destino: { campaign, tipoCurso, horarioCurso, salon } }
 *
 * Le asigna salón a un alumno que volvió del OnHold sin él. Reusa Cambio
 * Académico (valida el cupo con el salón bloqueado, lo pone en la lección por la
 * que va el salón y le agenda las clases futuras) y le confirma el asiento.
 *
 * Sólo para quien está en la lista: si el alumno ya tiene curso, el camino es
 * Cambio Académico desde su ficha, no éste.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, StudentPermission.ACTIVAR_HOLD);
  const body = await request.json().catch(() => ({}));
  const academicaId = String(body?.academicaId || '').trim();
  const d = body?.destino || {};
  const destino = {
    campaign: String(d.campaign || '').trim(),
    tipoCurso: String(d.tipoCurso || '').trim(),
    horarioCurso: String(d.horarioCurso || '').trim(),
    salon: String(d.salon || '').trim(),
  };
  if (!academicaId) throw new ValidationError('Falta el estudiante.');
  if (!destino.campaign || !destino.tipoCurso || !destino.horarioCurso) {
    throw new ValidationError('Debe indicar campaña, curso y salón.');
  }

  const pendientes = await listarReactivadosSinSalon();
  if (!pendientes.some((r: any) => r.academicaId === academicaId)) {
    throw new ValidationError('El estudiante no está en la lista de reactivados sin salón (ya tiene curso o sigue en OnHold).');
  }

  const r = await cambiarCursoAcademico(
    academicaId,
    { ...destino, motivo: 'Asignación de salón al volver de OnHold' } as any,
    { email: session.user?.email ?? null, nombre: session.user?.name ?? null },
    { confirmarCupo: true }
  );

  return successResponse({
    ...r,
    message: `Salón asignado${r.bookingsCreados ? ` con ${r.bookingsCreados} clase(s)` : ''}.`,
  });
});
