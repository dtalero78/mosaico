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
/**
 * Únicos estados del contrato en los que se puede volver a asignar un cupo.
 * Con el contrato Rechazado/Retractado/Contrato nulo NO se reasigna: habría que
 * revivir un contrato anulado por la puerta de atrás. Aprobado tampoco entra
 * aquí, porque ahí el cupo ya está tomado y bloqueado.
 */
const PERMITEN_ASIGNAR = ['pendiente', 'devuelto'];

export const POST = handlerWithAuth(async (request, ctx, session) => {
  // Mismo permiso que "Inactivar" del beneficiario, que es la otra vía de liberar
  // su cupo: quien puede una, puede la otra.
  await requirePermission(session, PersonPermission.ACTIVAR_DESACTIVAR);

  const id = String((ctx as any)?.params?.id || '').trim();
  const b = await request.json().catch(() => ({}));
  const liberar = !!b?.liberar;
  if (!id) throw new ValidationError('Falta el beneficiario.');

  const persona = await queryOne<any>(
    `SELECT "_id","tipoUsuario","aprobacion","contrato","campaign","tipoCurso","horarioCurso","salon",
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

  // --- LIBERAR: apaga la marca Y BORRA el curso --------------------------------
  // Soltar el cupo es dejar el salón: el alumno queda sin campaña/curso/horario/
  // salón. Así desaparece de las listas del salón por el propio dato (no sólo por
  // la regla de cupo), no se le generan agendamientos, y la aprobación lo salta
  // (ver `motivoNoAprobable` en approval.service). Para volver a entrar hay que
  // pasar por "Asignar cupo", que exige elegir destino con disponibilidad.
  if (liberar) {
    await query(
      `UPDATE "PEOPLE"
          SET "cupoLiberado" = true, "cupoLiberadoPor" = $1, "cupoLiberadoEn" = NOW(),
              "campaign" = NULL, "tipoCurso" = NULL, "horarioCurso" = NULL, "salon" = NULL,
              "_updatedDate" = NOW()
        WHERE "_id" = $2`,
      [email, id]
    );
    // ACADEMICA sigue al beneficiario (si ya tiene ficha).
    await query(
      `UPDATE "ACADEMICA" SET "campaign" = NULL, "salon" = NULL, "_updatedDate" = NOW()
        WHERE "numeroId" = (SELECT "numeroId" FROM "PEOPLE" WHERE "_id" = $1)`,
      [id]
    ).catch(() => { /* best-effort: puede no tener ficha aún */ });

    return successResponse({
      ok: true, cupoLiberado: true, nombre: persona.nombre,
      cursoBorrado: {
        campaign: persona.campaign || null, tipoCurso: persona.tipoCurso || null,
        horarioCurso: persona.horarioCurso || null, salon: persona.salon || null,
      },
    });
  }

  // --- ASIGNAR: exige contrato en un estado que lo permita y destino con cupo --
  const titular = await queryOne<{ aprobacion: string | null }>(
    `SELECT "aprobacion" FROM "PEOPLE"
      WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR' LIMIT 1`,
    [persona.contrato]
  );
  const estadoContrato = String(titular?.aprobacion || '').trim().toLowerCase() || 'pendiente';
  if (!PERMITEN_ASIGNAR.includes(estadoContrato)) {
    throw new ForbiddenError(
      `No está permitido asignar cupo con el contrato en estado "${titular?.aprobacion || 'Pendiente'}". Consulte al administrador.`
    );
  }

  // Destino: el curso donde se le asigna el cupo. Si no se envía, se conserva el suyo.
  const destino = {
    campaign: String(b?.destino?.campaign || persona.campaign || '').trim(),
    tipoCurso: String(b?.destino?.tipoCurso || persona.tipoCurso || '').trim(),
    horarioCurso: String(b?.destino?.horarioCurso || persona.horarioCurso || '').trim(),
    salon: String(b?.destino?.salon ?? persona.salon ?? '').trim(),
  };
  if (!destino.campaign || !destino.tipoCurso || !destino.horarioCurso) {
    throw new ValidationError('Falta la campaña, el curso o el horario del salón destino.');
  }

  // El curso destino debe existir, estar activo y TENER cupo disponible.
  const curso = await queryOne<{ cupos: number; ocupados: number }>(
    `SELECT COALESCE(cc."numeroUsuarios",0)::int AS cupos,
            (SELECT COUNT(*)::int FROM "PEOPLE" p
              WHERE p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
                AND p."campaign" = cc."campaign"
                AND UPPER(p."tipoCurso") = UPPER(cc."tipoCurso")
                AND p."horarioCurso" = cc."horarioCurso"
                AND p."_id" <> $4
                AND p."cupoLiberado" IS NOT TRUE
                AND p."fechaOnHold" IS NULL) AS ocupados
       FROM "CURSOS_CAMPAIGN" cc
      WHERE cc."campaign" = $1 AND UPPER(cc."tipoCurso") = UPPER($2)
        AND cc."horarioCurso" = $3 AND cc."activa" = true
      LIMIT 1`,
    [destino.campaign, destino.tipoCurso, destino.horarioCurso, id]
  );
  if (!curso) throw new ValidationError('El curso/salón destino no existe o no está activo.');
  if (curso.cupos > 0 && curso.ocupados >= curso.cupos) {
    throw new ValidationError(
      `El salón destino ya está lleno (${curso.ocupados}/${curso.cupos}). Elige otro con disponibilidad.`
    );
  }

  // Se mueve al beneficiario al destino y se le devuelve el cupo. Queda PENDIENTE:
  // el paso siguiente es aprobarlo (el cupo ya cuenta, como cualquier pendiente).
  await query(
    `UPDATE "PEOPLE"
        SET "campaign" = $1, "tipoCurso" = $2, "horarioCurso" = $3, "salon" = $4,
            "cupoLiberado" = false, "cupoLiberadoPor" = NULL, "cupoLiberadoEn" = NULL,
            "_updatedDate" = NOW()
      WHERE "_id" = $5`,
    [destino.campaign, destino.tipoCurso, destino.horarioCurso, destino.salon || null, id]
  );
  // ACADEMICA sigue al beneficiario (si ya tiene ficha académica).
  await query(
    `UPDATE "ACADEMICA" SET "campaign" = $1, "salon" = $2, "_updatedDate" = NOW()
      WHERE "numeroId" = (SELECT "numeroId" FROM "PEOPLE" WHERE "_id" = $3)`,
    [destino.campaign, destino.salon || null, id]
  ).catch(() => { /* best-effort: puede no tener ficha aún */ });

  return successResponse({
    ok: true, cupoLiberado: false, nombre: persona.nombre,
    destino, cupos: curso.cupos, ocupados: curso.ocupados + 1,
    requiereAprobacion: true,
  });
});
