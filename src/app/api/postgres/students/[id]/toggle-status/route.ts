import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { toggleStatus } from '@/services/student.service';
import { cambiarCursoAcademico } from '@/services/cambio-academico.service';
import { PeopleRepository } from '@/repositories/people.repository';
import { ValidationError } from '@/lib/errors';
import { parseTipoSalida } from '@/lib/tipo-salida-cupo';
import { queryOne } from '@/lib/postgres';

/**
 * POST /api/postgres/students/[id]/toggle-status
 *
 * Toggle administrative suspension of a person (titular or beneficiary).
 *
 * Body: { active: boolean, motivo: string, destino?, academicaId? }
 *
 * `motivo` is required for both INACTIVACION and REACTIVACION — it is
 * persisted in PEOPLE.suspenddata along with the executor's email taken
 * from the NextAuth session. The body cannot spoof `realizadoPor`.
 *
 * Al INACTIVAR se SUELTA el asiento del alumno: se borra su curso, se sueltan sus
 * clases futuras y queda escrito en `cupoHistory` de dónde salió
 * (`liberarCupoBeneficiario`). Por eso al REACTIVAR (active=true) se DEBE indicar
 * `destino` {campaign, tipoCurso, horarioCurso, salon} + `academicaId`: ya no tiene
 * salón al que volver, hay que elegirle uno con cupo.
 *
 * `tipoSalida` es OBLIGATORIO al inactivar y dice cómo sale:
 *   'REEMPLAZO' — su asiento se le da a otro; no se le ofrece "Activar".
 *   'TEMPORAL'  — puede volver eligiendo un salón con cupo.
 * Las dos sueltan el asiento igual; lo que cambia es el regreso.
 *
 * suspendcount increments only on INACTIVACION.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, PersonPermission.ACTIVAR_DESACTIVAR);
  const body = await request.json().catch(() => ({}));
  const { active, motivo } = body;

  if (active === undefined) throw new ValidationError('active (boolean) is required');
  if (typeof motivo !== 'string' || !motivo.trim()) {
    throw new ValidationError('motivo (texto) es obligatorio');
  }

  // El tipo de salida se exige aquí, no sólo en el formulario: es lo que decide si
  // el alumno podrá volver, y un cliente que no lo mande dejaría esa decisión sin
  // tomar y el asiento en el aire.
  const tipoSalida = active === false ? parseTipoSalida(body.tipoSalida) : null;
  if (active === false && tipoSalida === null) {
    throw new ValidationError(
      'tipoSalida es obligatorio al inactivar: "REEMPLAZO" (su cupo pasa a otro) o "TEMPORAL" (podrá volver).'
    );
  }

  const realizadoPor = (session?.user as any)?.email || 'unknown';
  const realizadoPorNombre = (session?.user as any)?.name || undefined;

  // Reactivación con destino: validar cupo + mover al curso/salón elegido antes de reactivar.
  const destino = body.destino;
  if (active === true && destino && body.academicaId) {
    const campaign = String(destino.campaign || '').trim();
    const tipoCurso = String(destino.tipoCurso || '').trim();
    const horarioCurso = String(destino.horarioCurso || '').trim();
    const salon = String(destino.salon || '').trim();
    if (!campaign || !tipoCurso || !horarioCurso) {
      throw new ValidationError('Debe indicar campaña, curso y salón destino para reactivar.');
    }
    const dest = await queryOne<any>(
      `SELECT 1 FROM "CURSOS_CAMPAIGN"
        WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 AND "activa"=true LIMIT 1`,
      [campaign, tipoCurso, horarioCurso]
    );
    if (!dest) throw new ValidationError(`El curso ${tipoCurso} ${horarioCurso} no existe en la campaña ${campaign}.`);
    // El cupo lo valida `cambiarCursoAcademico` dentro de su transacción y con el
    // salón bloqueado — comprobarlo aquí, fuera, dejaba pasar dos reactivaciones
    // simultáneas al último asiento.
    await cambiarCursoAcademico(
      body.academicaId,
      { campaign, tipoCurso, horarioCurso, salon, motivo: 'Reactivación de beneficiario' } as any,
      { email: session.user?.email ?? null, nombre: session.user?.name ?? null }
    );
  }

  const result = await toggleStatus(params.id, active, {
    motivo: motivo.trim(),
    realizadoPor,
    realizadoPorNombre,
    tipoSalida: (tipoSalida as 'REEMPLAZO' | 'TEMPORAL' | null),
  });

  return successResponse({
    message: result.statusChanged
      ? `Student ${active ? 'activated' : 'deactivated'} successfully`
      : `Student is already ${active ? 'active' : 'inactive'}`,
    student: result.student,
    statusChanged: result.statusChanged,
    previousStatus: result.previousStatus,
    newStatus: result.newStatus,
    suspenddata: result.suspenddata ?? null,
    cupoLiberado: (result as any).cupoLiberado ?? false,
    clasesSoltadas: (result as any).clasesSoltadas ?? 0,
  });
});

/**
 * GET /api/postgres/students/[id]/toggle-status
 *
 * Get student's current status
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const person = await PeopleRepository.findByIdOrNumeroIdOrThrow(params.id);

  return successResponse({
    student: {
      _id: person._id,
      numeroId: person.numeroId,
      nombre: `${person.primerNombre} ${person.primerApellido}`,
      estadoInactivo: person.estadoInactivo,
      active: !person.estadoInactivo,
      suspenddata: person.suspenddata ?? null,
      suspendcount: person.suspendcount ?? 0,
    },
  });
});
