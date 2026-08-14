import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/reports/academico/evaluaciones/preguntas?curso=&salon=&code=&step=
 *
 * Pestaña "Preguntas": por cada evaluación (cuestionario), las 3 preguntas con
 * MÁS errores y las 3 con MÁS aciertos, con el número y el porcentaje.
 *
 * Se cuenta CADA respuesta enviada — es decir, todos los intentos, no sólo el
 * último: si una pregunta se falla dos veces, cuenta dos veces. Así el ranking
 * refleja lo que de verdad le cuesta al grupo, no cuántos acabaron aprobando.
 *
 * El detalle vive en EVALUACION_RESPUESTAS."respuestas" (JSONB
 * [{qId, question, selected, correct, ok}]), que se expande con
 * jsonb_array_elements. Gateado por ACADEMICO.EVALUACIONES.VER.
 */
const TOP = 3;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requireAnyPermission(session, [AcademicoPermission.EVALUACIONES_VER, AcademicoPermission.ENTRENAMIENTOS_VER]);
  const sp = new URL(request.url).searchParams;
  const curso = (sp.get('curso') || '').trim();
  const salon = (sp.get('salon') || '').trim();
  const code = (sp.get('code') || '').trim();
  const step = (sp.get('step') || '').trim();
  const tipo = (sp.get('tipo') || '').trim().toLowerCase();

  if (!curso) return successResponse({ available: true, evaluaciones: [], curso: '', salon: '' });

  const where: string[] = [`UPPER(er."curso") = UPPER($1)`, `er."enviadaEn" IS NOT NULL`, `er."respuestas" IS NOT NULL`];
  const params: any[] = [curso];
  let join = '';
  if (tipo === 'evaluacion') where.push(`er."code" ILIKE '%evaluac%'`);
  else if (tipo === 'entrenamiento') where.push(`er."code" ILIKE '%entren%'`);
  if (code) { where.push(`er."code" = $${params.length + 1}`); params.push(code); }
  if (step) { where.push(`er."step" = $${params.length + 1}`); params.push(step); }
  if (salon) {
    join = `JOIN "PEOPLE" p ON UPPER(p."numeroId") = UPPER(er."numeroId") AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')`;
    where.push(`p."salon" = $${params.length + 1}`); params.push(salon);
  }

  // Una fila por (cuestionario, pregunta) con sus aciertos y errores.
  const rows = (await query<any>(
    `SELECT er."code", er."step", er."cuestionarioId",
            MAX(er."cuestionarioTitulo") AS titulo,
            COALESCE(NULLIF(TRIM(q->>'question'), ''), 'Pregunta ' || COALESCE(q->>'qId','?')) AS pregunta,
            COUNT(*)::int AS respuestas,
            COUNT(*) FILTER (WHERE (q->>'ok') = 'true')::int AS aciertos,
            COUNT(*) FILTER (WHERE (q->>'ok') IS DISTINCT FROM 'true')::int AS errores,
            COUNT(DISTINCT er."academicaId")::int AS estudiantes
       FROM "EVALUACION_RESPUESTAS" er ${join}
       CROSS JOIN LATERAL jsonb_array_elements(er."respuestas") AS q
      WHERE ${where.join(' AND ')}
      GROUP BY er."code", er."step", er."cuestionarioId", pregunta
      HAVING COUNT(*) > 0`,
    params
  )).rows;

  // Se agrupa por cuestionario y se sacan los dos rankings.
  const mapa = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.code}|${r.step}|${r.cuestionarioId ?? ''}`;
    if (!mapa.has(k)) {
      mapa.set(k, {
        code: r.code, step: r.step, cuestionarioId: r.cuestionarioId,
        titulo: r.titulo || 'Cuestionario',
        estudiantes: 0, totalRespuestas: 0, totalAciertos: 0,
        preguntas: [] as any[],
      });
    }
    const g = mapa.get(k);
    const respuestas = Number(r.respuestas) || 0;
    const aciertos = Number(r.aciertos) || 0;
    const errores = Number(r.errores) || 0;
    g.estudiantes = Math.max(g.estudiantes, Number(r.estudiantes) || 0);
    g.totalRespuestas += respuestas;
    g.totalAciertos += aciertos;
    g.preguntas.push({
      pregunta: r.pregunta,
      respuestas, aciertos, errores,
      pctError: respuestas ? Math.round((errores / respuestas) * 100) : 0,
      pctAcierto: respuestas ? Math.round((aciertos / respuestas) * 100) : 0,
    });
  }

  const evaluaciones = Array.from(mapa.values()).map(g => ({
    code: g.code, step: g.step, cuestionarioId: g.cuestionarioId, titulo: g.titulo,
    estudiantes: g.estudiantes,
    // % de acierto del cuestionario completo, para dar contexto al ranking.
    pctAciertoGlobal: g.totalRespuestas ? Math.round((g.totalAciertos / g.totalRespuestas) * 100) : 0,
    totalPreguntas: g.preguntas.length,
    // Más erradas: más errores primero; a igualdad, la de mayor % de error.
    masErradas: [...g.preguntas]
      .filter((p: any) => p.errores > 0)
      .sort((a: any, b: any) => b.errores - a.errores || b.pctError - a.pctError)
      .slice(0, TOP),
    // Mayor acertividad: más aciertos primero.
    masAcertadas: [...g.preguntas]
      .filter((p: any) => p.aciertos > 0)
      .sort((a: any, b: any) => b.aciertos - a.aciertos || b.pctAcierto - a.pctAcierto)
      .slice(0, TOP),
  })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.step).localeCompare(String(b.step)));

  return successResponse({ available: true, evaluaciones, curso, salon });
});
