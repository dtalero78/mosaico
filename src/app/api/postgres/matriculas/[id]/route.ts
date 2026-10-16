import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission } from '@/lib/api-permissions';
import { ComercialPermission, PersonPermission } from '@/types/permissions';
import { query, queryOne } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { estadoContratoTitular } from '@/lib/estado-contrato';

/**
 * GET /api/postgres/matriculas/[id]   (id = PEOPLE._id del titular O de un beneficiario)
 *
 * Resumen de Matrícula (vista de tarjetas, traída de LGS): el titular con su ficha y
 * el estado del contrato, y una tarjeta por beneficiario del mismo contrato.
 *
 * Diferencia con LGS: allá el curso, salón, horario y apoderado sólo existen para los
 * beneficiarios KIDS (tabla KIDS_INSCRIPCIONES). En MOSAICO son datos de TODO
 * beneficiario y viven en su fila de PEOPLE, así que se devuelven siempre.
 *
 * El perfil académico se busca por el enlace directo (`ACADEMICA.peopleId` /
 * `studentId` = PEOPLE._id) y sólo como respaldo por documento: hubo fichas
 * duplicadas por documento editado, y el documento solo podía resolver a la
 * ficha equivocada.
 */
export const GET = handlerWithAuth(async (_req, ctx, session) => {
  // Botón "Resumen" de la ficha (PERSON.INFO.RESUMEN) o la lista de Matrículas
  // (COMERCIAL.MATRICULAS.DETALLE): cualquiera de los dos abre el resumen.
  await requireAnyPermission(session, [PersonPermission.RESUMEN, ComercialPermission.MATRICULAS_DETALLE]);

  let id = String((ctx as any)?.params?.id || '').trim();
  if (!id) throw new ValidationError('Falta el id de la persona.');

  // Desde la ficha de un BENEFICIARIO se resuelve el titular de su contrato.
  const persona = await queryOne<{ tipoUsuario: string | null; contrato: string | null }>(
    `SELECT "tipoUsuario", "contrato" FROM "PEOPLE" WHERE "_id" = $1 LIMIT 1`, [id]
  );
  if (!persona) throw new NotFoundError('Persona', id);
  if (persona.tipoUsuario !== 'TITULAR' && persona.contrato) {
    const tit = await queryOne<{ _id: string }>(
      `SELECT "_id" FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
        ORDER BY "_createdDate" ASC LIMIT 1`, [persona.contrato]
    );
    if (tit) id = tit._id;
  }

  const titular = await queryOne<any>(
    `SELECT p."_id", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."numeroId", p."contrato", p."plataforma", p."celular", p."email", p."domicilio",
            p."ciudad", p."fechaNacimiento", p."aprobacion", p."estado", p."hashConsentimiento",
            p."gestionContratoListo", p."asesor", p."asesorMail", p."liderComercial",
            p."inicioContrato", p."fechaContrato", p."finalContrato", p."vigencia", p."modulo"
       FROM "PEOPLE" p WHERE p."_id" = $1 AND p."tipoUsuario" = 'TITULAR' LIMIT 1`,
    [id]
  );
  if (!titular) throw new NotFoundError('Titular', id);

  const estadoMatricula = estadoContratoTitular(titular.aprobacion, titular.gestionContratoListo);
  const firmado = !!(titular.hashConsentimiento && String(titular.hashConsentimiento).trim());

  const beneficiarios = (await query(
    `SELECT p."_id", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."numeroId", p."celular", p."email", p."plataforma", p."fechaNacimiento",
            p."aprobacion", p."estadoInactivo", p."fechaOnHold", p."suspenddata",
            p."campaign", p."tipoCurso", p."horarioCurso", p."salon",
            p."cupoConfirmado", p."cupoLiberado",
            p."apoderado", p."apoderadoTelefono", p."apoderadoMail",
            a."_id" AS "academicaId", a."curso" AS "academicaCurso", a."nivel", a."step",
            a."userLogin", a."estadoInactivo" AS "academicaInactivo"
       FROM "PEOPLE" p
       LEFT JOIN LATERAL (
         SELECT "_id", "curso", "nivel", "step", "userLogin", "estadoInactivo"
           FROM "ACADEMICA"
          WHERE "peopleId" = p."_id" OR "studentId" = p."_id" OR "numeroId" = p."numeroId"
          ORDER BY (CASE WHEN "peopleId" = p."_id" OR "studentId" = p."_id" THEN 0 ELSE 1 END),
                   (CASE WHEN "tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END)
          LIMIT 1
       ) a ON true
      WHERE p."contrato" = $1 AND p."tipoUsuario" <> 'TITULAR'
      ORDER BY p."primerApellido", p."primerNombre"`,
    [titular.contrato]
  )).rows.map((b: any) => {
    const suspendido = b.estadoInactivo === true && b.suspenddata?.accion === 'INACTIVACION';
    const cupo = b.cupoLiberado === true ? 'LIBERADO' : b.cupoConfirmado === true ? 'CONFIRMADO' : 'PROVISIONAL';
    return {
      ...b,
      tienePerfilAcademico: !!b.academicaId,
      enWelcome: String(b.academicaCurso || '').toUpperCase() === 'WELCOME',
      enOnHold: !!b.fechaOnHold,
      suspendido,
      cupo,
    };
  });

  return successResponse({
    titular: { ...titular, estadoMatricula, firmado },
    beneficiarios,
    totalBeneficiarios: beneficiarios.length,
  });
});
