import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { toggleStatus } from '@/services/student.service';
import { cambiarCursoAcademico } from '@/services/cambio-academico.service';
import { PeopleRepository } from '@/repositories/people.repository';
import { ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';

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
 * Al INACTIVAR un beneficiario se LIBERA su cupo (regla lib/cupo). Por eso, al
 * REACTIVAR (active=true) se DEBE indicar `destino` {campaign, tipoCurso,
 * horarioCurso, salon} + `academicaId`: se valida cupo del destino y se mueve al
 * alumno allí (reusa Cambio Académico) ANTES de reactivar.
 *
 * suspendcount increments only on INACTIVACION.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  const body = await request.json().catch(() => ({}));
  const { active, motivo } = body;

  if (active === undefined) throw new ValidationError('active (boolean) is required');
  if (typeof motivo !== 'string' || !motivo.trim()) {
    throw new ValidationError('motivo (texto) es obligatorio');
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
      `SELECT COALESCE("numeroUsuarios",0) AS cupos,
              (SELECT COUNT(*)::int FROM "PEOPLE" pe
                 WHERE pe."tipoUsuario"='BENEFICIARIO'
                   AND pe."campaign"=$1 AND pe."tipoCurso"=$2 AND pe."horarioCurso"=$3
                   AND ${cupoOcupadoSql('pe')}) AS ocupados
         FROM "CURSOS_CAMPAIGN"
        WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 AND "activa"=true LIMIT 1`,
      [campaign, tipoCurso, horarioCurso]
    );
    if (!dest) throw new ValidationError(`El curso ${tipoCurso} ${horarioCurso} no existe en la campaña ${campaign}.`);
    if (dest.cupos > 0 && dest.ocupados >= dest.cupos) {
      throw new ValidationError(`El curso destino ${tipoCurso} ${horarioCurso} (${campaign}) está lleno (${dest.ocupados}/${dest.cupos}). Elige otro con cupo.`);
    }
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
