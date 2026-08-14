import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/reports/academico/evaluaciones/detalle
 *   ?academicaId=…&code=…&step=…&cuestionarioId=…
 *
 * Devuelve el ÚLTIMO intento del estudiante en ese cuestionario, con el detalle
 * pregunta por pregunta (qué respondió, cuál era la correcta y si acertó), más el
 * historial de sus intentos (hasta 3) para ver la evolución.
 * Lo usa el modal de Académico › Evaluaciones al hacer clic en un estudiante.
 * Gateado por ACADEMICO.EVALUACIONES.VER.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requireAnyPermission(session, [AcademicoPermission.EVALUACIONES_VER, AcademicoPermission.ENTRENAMIENTOS_VER]);
  const sp = new URL(request.url).searchParams;
  const academicaId = (sp.get('academicaId') || '').trim();
  const code = (sp.get('code') || '').trim();
  const step = (sp.get('step') || '').trim();
  const cuestionarioId = (sp.get('cuestionarioId') || '').trim();
  if (!academicaId) throw new ValidationError('Falta el estudiante.');

  const where: string[] = [`er."academicaId" = $1`, `er."enviadaEn" IS NOT NULL`];
  const params: any[] = [academicaId];
  if (code) { where.push(`er."code" = $${params.length + 1}`); params.push(code); }
  if (step) { where.push(`er."step" = $${params.length + 1}`); params.push(step); }
  // cuestionarioId NULL en filas viejas = el primer cuestionario de la lección.
  if (cuestionarioId) {
    where.push(`(er."cuestionarioId" = $${params.length + 1} OR er."cuestionarioId" IS NULL)`);
    params.push(cuestionarioId);
  }

  const intentos = (await query<any>(
    `SELECT er."_id", er."nombre", er."numeroId", er."curso", er."code", er."step",
            er."cuestionarioId", er."cuestionarioTitulo",
            er."respuestas", er."score", er."total", er."porcentaje", er."aprobado",
            er."intento", er."iniciadaEn", er."enviadaEn", er."duracionSeg"
       FROM "EVALUACION_RESPUESTAS" er
      WHERE ${where.join(' AND ')}
      ORDER BY er."intento" DESC NULLS LAST, er."enviadaEn" DESC NULLS LAST`,
    params
  )).rows;

  if (!intentos.length) throw new NotFoundError('Intentos de la evaluación', academicaId);

  const ultimo = intentos[0];
  const detalle = Array.isArray(ultimo.respuestas)
    ? ultimo.respuestas
    : (() => { try { return JSON.parse(ultimo.respuestas || '[]'); } catch { return []; } })();

  const correctas = detalle.filter((d: any) => d?.ok).length;
  const total = Number(ultimo.total) || detalle.length;

  return successResponse({
    estudiante: { academicaId, nombre: ultimo.nombre || '(sin nombre)', numeroId: ultimo.numeroId || '' },
    curso: ultimo.curso, code: ultimo.code, step: ultimo.step,
    cuestionarioTitulo: ultimo.cuestionarioTitulo || 'Cuestionario',
    ultimo: {
      intento: Number(ultimo.intento) || intentos.length,
      score: Number(ultimo.score) || 0,
      total,
      correctas,
      incorrectas: Math.max(0, total - correctas),
      porcentaje: Number(ultimo.porcentaje) || 0,
      aprobado: !!ultimo.aprobado,
      enviadaEn: ultimo.enviadaEn,
      duracionSeg: ultimo.duracionSeg,
      // [{ qId, question, selected, correct, ok }]
      respuestas: detalle,
    },
    // Historial (incluye el último), del más reciente al más antiguo.
    historial: intentos.map((r: any) => ({
      intento: Number(r.intento) || 0,
      score: Number(r.score) || 0,
      total: Number(r.total) || 0,
      porcentaje: Number(r.porcentaje) || 0,
      aprobado: !!r.aprobado,
      enviadaEn: r.enviadaEn,
    })),
  });
});
