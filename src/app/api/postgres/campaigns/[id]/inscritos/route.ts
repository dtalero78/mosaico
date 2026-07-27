/**
 * GET /api/postgres/campaigns/[id]/inscritos   [id] = CURSOS_CAMPAIGN._id
 *
 * Lista los BENEFICIARIOS inscritos en ese curso/salón (el que corresponde al badge de
 * Cupos en Académico › Campañas › Reporte). Resuelve el curso por su _id y busca en PEOPLE
 * por (campaign + tipoCurso + horarioCurso) — la misma clave con la que se cuenta
 * `usuInscritos` — así el listado coincide con el número de cupos.
 *
 * Permiso: ACADEMICO.CAMPANA.CREAR (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { NotFoundError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);

  const curso = await queryOne<{ campaign: string; tipoCurso: string; horarioCurso: string; salon: string | null }>(
    `SELECT "campaign","tipoCurso","horarioCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`,
    [params.id]
  );
  if (!curso) throw new NotFoundError('CURSOS_CAMPAIGN', params.id);

  const inscritos = await queryMany<any>(
    `SELECT p."_id"            AS "peopleId",
            a."_id"            AS "academicaId",
            p."numeroId",
            p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."salon", p."contrato", p."aprobacion", p."estadoInactivo"
       FROM "PEOPLE" p
       LEFT JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId" AND a."tipoUsuario" = 'BENEFICIARIO'
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3
      ORDER BY p."primerApellido" NULLS LAST, p."primerNombre" NULLS LAST`,
    [curso.campaign, curso.tipoCurso, curso.horarioCurso]
  );

  const items = inscritos.map((r) => ({
    peopleId: r.peopleId,
    academicaId: r.academicaId ?? null,
    numeroId: r.numeroId ?? '—',
    nombre: [r.primerNombre, r.segundoNombre, r.primerApellido, r.segundoApellido].filter(Boolean).join(' ') || '—',
    salon: r.salon ?? null,
    contrato: r.contrato ?? null,
    aprobacion: r.aprobacion ?? null,
    inactivo: r.estadoInactivo === true,
  }));

  return successResponse({
    curso: { campaign: curso.campaign, tipoCurso: curso.tipoCurso, horarioCurso: curso.horarioCurso, salon: curso.salon },
    total: items.length,
    items,
  });
});
