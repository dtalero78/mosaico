import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ForbiddenError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';

/**
 * POST /api/postgres/people/[id]/cupo   (id = PEOPLE._id del BENEFICIARIO)
 * Body: { liberar: boolean }
 *
 * Libera o vuelve a tomar el cupo del beneficiario en su salón, a mano.
 *
 * Regla (decisión del usuario): con el contrato **APROBADO** el cupo queda
 * BLOQUEADO — no se puede liberar. Para abrirlo hay que cambiar antes el estado del
 * contrato. Retomar un cupo sí se permite siempre (no quita nada a nadie), pero se
 * avisa si el curso ya está lleno.
 *
 * La validación vive aquí, no sólo en la interfaz.
 */
const APROBADOS = ['aprobado', 'aprobada'];

export const POST = handlerWithAuth(async (request, ctx, session) => {
  // Mismo permiso que "Inactivar" del beneficiario, que es la otra vía de liberar
  // su cupo: quien puede una, puede la otra.
  await requirePermission(session, PersonPermission.ACTIVAR_DESACTIVAR);

  const id = String((ctx as any)?.params?.id || '').trim();
  const b = await request.json().catch(() => ({}));
  const liberar = !!b?.liberar;
  if (!id) throw new ValidationError('Falta el beneficiario.');

  const persona = await queryOne<any>(
    `SELECT "_id","tipoUsuario","aprobacion","campaign","tipoCurso","horarioCurso","salon",
            "cupoLiberado",
            TRIM(CONCAT_WS(' ', "primerNombre", "primerApellido")) AS nombre
       FROM "PEOPLE" WHERE "_id" = $1`,
    [id]
  );
  if (!persona) throw new NotFoundError('Beneficiario', id);
  if (String(persona.tipoUsuario || '').toUpperCase() === 'TITULAR') {
    throw new ValidationError('El cupo es del beneficiario, no del titular.');
  }

  const aprobado = APROBADOS.includes(String(persona.aprobacion || '').trim().toLowerCase());
  if (liberar && aprobado) {
    throw new ForbiddenError(
      'El contrato está aprobado: el cupo queda asignado. Cambia primero el estado del contrato para poder liberarlo.'
    );
  }

  const email = (session as any)?.user?.email || 'desconocido';
  await query(
    `UPDATE "PEOPLE"
        SET "cupoLiberado"    = $1,
            "cupoLiberadoPor" = CASE WHEN $1 THEN $2 ELSE NULL END,
            "cupoLiberadoEn"  = CASE WHEN $1 THEN NOW() ELSE NULL END,
            "_updatedDate"    = NOW()
      WHERE "_id" = $3`,
    [liberar, email, id]
  );

  // Aviso (no bloquea) si al retomarlo el curso ya no tiene espacio.
  let avisoLleno = false;
  if (!liberar && persona.campaign && persona.tipoCurso && persona.horarioCurso) {
    const cupo = await queryOne<{ cupos: number; ocupados: number }>(
      `SELECT COALESCE(cc."numeroUsuarios",0)::int AS cupos,
              (SELECT COUNT(*)::int FROM "PEOPLE" p
                WHERE p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
                  AND p."campaign" = cc."campaign"
                  AND UPPER(p."tipoCurso") = UPPER(cc."tipoCurso")
                  AND p."horarioCurso" = cc."horarioCurso"
                  AND p."cupoLiberado" IS NOT TRUE) AS ocupados
         FROM "CURSOS_CAMPAIGN" cc
        WHERE cc."campaign" = $1 AND UPPER(cc."tipoCurso") = UPPER($2) AND cc."horarioCurso" = $3
        LIMIT 1`,
      [persona.campaign, persona.tipoCurso, persona.horarioCurso]
    ).catch(() => null);
    if (cupo && cupo.cupos > 0 && cupo.ocupados > cupo.cupos) avisoLleno = true;
  }

  return successResponse({ ok: true, cupoLiberado: liberar, avisoLleno, nombre: persona.nombre });
});
