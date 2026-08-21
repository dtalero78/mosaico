import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { StudentPermission } from '@/types/permissions';
import { activateOnHold, deactivateOnHold } from '@/services/contract.service';
import { cambiarCursoAcademico } from '@/services/cambio-academico.service';
import { generarBookingsBeneficiario } from '@/services/cursos-campaign-eventos.service';
import { ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';

/**
 * POST /api/postgres/students/onhold
 *
 * Activate or deactivate OnHold status for a student.
 * When deactivating, automatically extends the contract by the paused days.
 */
export const POST = handlerWithAuth(async (request, context, session) => {
  await requirePermission(session, StudentPermission.ACTIVAR_HOLD);
  const body = await request.json();

  if (!body.studentId) throw new ValidationError('studentId is required');
  if (body.setOnHold === undefined) throw new ValidationError('setOnHold is required');

  if (body.setOnHold) {
    if (!body.fechaOnHold || !body.fechaFinOnHold) {
      throw new ValidationError('fechaOnHold and fechaFinOnHold are required when activating OnHold');
    }

    const result = await activateOnHold({
      studentId: body.studentId,
      fechaOnHold: body.fechaOnHold,
      fechaFinOnHold: body.fechaFinOnHold,
      motivo: body.motivo,
      activadoPor: session.user?.name || session.user?.email || 'Unknown',
    });

    return successResponse({
      student: result.student,
      // El alumno suelta el salón: se dice cuántas clases se le quitaron para que
      // la pantalla pueda mostrarlo y no parezca que se perdieron solas.
      message: result.clasesSoltadas
        ? `OnHold activado — soltó su salón y ${result.clasesSoltadas} clase(s) por dictar`
        : 'OnHold activado — soltó su salón',
      onHoldEntry: result.onHoldEntry,
      clasesSoltadas: result.clasesSoltadas ?? 0,
    });
  }

  // Reactivar. Al restablecer se DEBE indicar campaña/curso/salón destino (con cupo).
  // Se mueve al alumno allí (reusa Cambio Académico) y luego se reactiva + extiende.
  let movido: any = null;
  const destino = body.destino;
  if (destino && body.academicaId) {
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
    // Mover al destino (PEOPLE/ACADEMICA/lección/bookings) antes de reactivar.
    movido = await cambiarCursoAcademico(
      body.academicaId,
      { campaign, tipoCurso, horarioCurso, salon, motivo: 'Reactivación desde OnHold' } as any,
      { email: session.user?.email ?? null, nombre: session.user?.name ?? null }
    );
  }

  const result = await deactivateOnHold(body.studentId);

  // Las clases del curso nuevo se generan AQUÍ, con el alumno ya reactivado.
  // El movimiento ocurre antes —para que un destino sin cupo lo deje en OnHold en
  // vez de reactivado y sin salón—, pero en ese momento sigue inactivo y
  // `cambiarCursoAcademico` no le agenda nada: volvía del OnHold con cero clases.
  let clasesCreadas = 0;
  if (destino && body.academicaId) {
    const p = await queryOne<any>(
      `SELECT "_id","numeroId","primerNombre","primerApellido","celular","plataforma","contrato",
              "campaign","tipoCurso","horarioCurso","salon"
         FROM "PEOPLE" WHERE "numeroId" = (SELECT "numeroId" FROM "ACADEMICA" WHERE "_id" = $1)
          AND "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') LIMIT 1`,
      [body.academicaId]
    );
    if (p) {
      clasesCreadas = await generarBookingsBeneficiario(body.academicaId, p, {
        soloFuturos: true,
        agendadoPor: `Reactivación desde OnHold (${session.user?.email || 'admin'})`,
      }).catch(() => 0);
    }
  }

  return successResponse({
    student: result.student,
    message: destino
      ? `OnHold desactivado: movido al curso destino${clasesCreadas ? ` con ${clasesCreadas} clase(s)` : ''} y contrato extendido.`
      : 'OnHold desactivado y contrato extendido automáticamente',
    extension: result.extension,
    movido,
    clasesCreadas,
  });
});
