/**
 * GET /api/postgres/campaigns/[id]/inscritos   [id] = CURSOS_CAMPAIGN._id
 *
 * Lista los BENEFICIARIOS inscritos en ese curso/salón (el que corresponde al badge de
 * Cupos en Académico › Campañas › Reporte). La consulta vive en
 * `inscritos-curso.service` (la comparte el Panel Guía).
 *
 * Permiso: ACADEMICO.CAMPANA.CREAR (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { listarInscritosCurso } from '@/services/inscritos-curso.service';

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const { curso, total, items } = await listarInscritosCurso(params.id);
  return successResponse({
    curso: { campaign: curso.campaign, tipoCurso: curso.tipoCurso, horarioCurso: curso.horarioCurso, salon: curso.salon },
    total,
    items,
  });
});
