/**
 * POST /api/postgres/guias/[id]/resetear-evaluacion   [id] = GUIAS._id
 * Body: { cursoId: string, academicaIds?: string[], todos?: boolean }
 *
 * Reinicia el contador de intentos de la ÚLTIMA evaluación de los alumnos
 * indicados (o de todos los del curso) para que puedan presentarla de nuevo, con
 * sus 3 intentos. No borra nada: los intentos quedan marcados `reseteado` (con
 * quién y cuándo) y dejan de contar para el tope; el historial se conserva.
 *
 * "Última evaluación" = la lección de módulo de evaluación (code ILIKE '%evaluac%')
 * del envío más reciente del alumno que aún cuente.
 *
 * Acceso: `ACADEMICO.PANEL_ALUMNOS.RESETEAR_EVALUACION` + el mismo alcance que el
 * panel (el rol GUIA sólo opera sobre SUS cursos; los alumnos se validan contra
 * el resumen del guía, nunca contra lo que mande el navegador).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission, tienePermiso } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { puedeVerPanelGuia } from '@/lib/alcance-guia';
import { esRolGuia, guiaIdDeSesion } from '@/services/guia-sesion.service';
import { getResumenGuia } from '@/services/resumen-guia.service';
import { query } from '@/lib/postgres';

export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.PANEL_ALUMNOS_RESETEAR_EVALUACION);

  const esGuia = esRolGuia(session);
  const permitido = puedeVerPanelGuia({
    esGuia,
    verTodos: !esGuia && await tienePermiso(session, AcademicoPermission.PANEL_ALUMNOS_VER_TODOS),
    guiaDeSesion: await guiaIdDeSesion((session as any)?.user?.email),
    guiaPedido: params.id,
  });
  if (!permitido) throw new ForbiddenError('Sólo puedes operar sobre tus propios cursos');

  const body = await request.json().catch(() => ({}));
  const cursoId = String(body?.cursoId || '');
  if (!cursoId) throw new ValidationError('Falta el curso.');

  // Alumnos válidos = los del curso en el resumen del guía.
  const resumen = await getResumenGuia(params.id);
  const curso = resumen.cursos.find((c) => c.cursoId === cursoId);
  if (!curso) throw new ValidationError('Ese curso no es del guía.');
  const delCurso = new Set(curso.filas.map((f) => f.academicaId).filter(Boolean) as string[]);

  let objetivo: string[];
  if (body?.todos === true) objetivo = Array.from(delCurso);
  else {
    const pedidos = Array.isArray(body?.academicaIds) ? body.academicaIds.map(String) : [];
    objetivo = Array.from(new Set(pedidos)).filter((id) => delCurso.has(id as string)) as string[];
  }
  if (!objetivo.length) throw new ValidationError('Marca al menos un alumno.');

  const quien = (session as any)?.user?.email || null;
  const r = await query<{ academicaId: string; code: string; step: string }>(
    `WITH ult AS (
       SELECT DISTINCT ON ("academicaId") "academicaId","code","step"
         FROM "EVALUACION_RESPUESTAS"
        WHERE "academicaId" = ANY($1::text[]) AND "reseteado" IS NOT TRUE
          AND "enviadaEn" IS NOT NULL AND "code" ILIKE '%evaluac%'
        ORDER BY "academicaId","enviadaEn" DESC)
     UPDATE "EVALUACION_RESPUESTAS" er
        SET "reseteado" = true, "reseteadoPor" = $2, "reseteadoEn" = NOW()
       FROM ult
      WHERE er."academicaId" = ult."academicaId" AND er."code" = ult."code" AND er."step" = ult."step"
        AND er."reseteado" IS NOT TRUE
    RETURNING er."academicaId", er."code", er."step"`,
    [objetivo, quien]
  );
  const conReset = new Set(r.rows.map((x) => x.academicaId));
  return successResponse({
    solicitados: objetivo.length,
    reseteados: conReset.size,
    sinEvaluacion: objetivo.length - conReset.size,
    intentosReiniciados: r.rowCount ?? 0,
  });
});
