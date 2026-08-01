import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/reports/academico/evaluaciones
 *   Filtros: curso (req), salon?, code? (módulo Evaluación), step? (lección).
 *   Devuelve, por (estudiante · cuestionario): intentos, mejor %, aprobado y estado.
 *   Lo usan la página Académico › Evaluaciones y el modal "Revisar Evaluación".
 *   Gateado por ACADEMICO.EVALUACIONES.VER.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.EVALUACIONES_VER);
  const sp = new URL(request.url).searchParams;
  const curso = (sp.get('curso') || '').trim();
  const salon = (sp.get('salon') || '').trim();
  const code = (sp.get('code') || '').trim();
  const step = (sp.get('step') || '').trim();

  // Catálogos para los dropdowns.
  const cursos = (await query<{ curso: string }>(
    `SELECT DISTINCT "curso" FROM "EVALUACION_RESPUESTAS" WHERE "curso" IS NOT NULL AND "curso"<>'' ORDER BY "curso"`
  )).rows.map(r => r.curso);

  if (!curso) return successResponse({ available: true, rows: [], cuestionarios: [], cursos, salones: [], curso: '', salon: '' });

  const salones = (await query<{ salon: string }>(
    `SELECT DISTINCT p."salon" FROM "EVALUACION_RESPUESTAS" er
       JOIN "PEOPLE" p ON UPPER(p."numeroId")=UPPER(er."numeroId") AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
      WHERE UPPER(er."curso")=UPPER($1) AND p."salon" IS NOT NULL AND p."salon"<>'' ORDER BY p."salon"`,
    [curso]
  )).rows.map(r => r.salon);

  const where: string[] = [`UPPER(er."curso")=UPPER($1)`, `er."enviadaEn" IS NOT NULL`];
  const params: any[] = [curso];
  let join = '';
  if (code) { where.push(`er."code"=$${params.length + 1}`); params.push(code); }
  if (step) { where.push(`er."step"=$${params.length + 1}`); params.push(step); }
  if (salon) {
    join = `JOIN "PEOPLE" p ON UPPER(p."numeroId")=UPPER(er."numeroId") AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')`;
    where.push(`p."salon"=$${params.length + 1}`); params.push(salon);
  }

  const raw = (await query<any>(
    `SELECT er."academicaId", er."numeroId", MAX(er."nombre") AS nombre, er."code", er."step",
            er."cuestionarioId", MAX(er."cuestionarioTitulo") AS titulo,
            COUNT(*)::int AS intentos, MAX(COALESCE(er."porcentaje",0))::int AS mejor,
            BOOL_OR(COALESCE(er."aprobado",false)) AS aprobado
       FROM "EVALUACION_RESPUESTAS" er ${join}
      WHERE ${where.join(' AND ')}
      GROUP BY er."academicaId", er."numeroId", er."code", er."step", er."cuestionarioId"
      ORDER BY MAX(er."nombre"), er."code", er."step"`,
    params
  )).rows;

  const rows = raw.map((r) => {
    const intentos = Number(r.intentos) || 0;
    const aprobado = !!r.aprobado;
    const estado = aprobado ? 'aprobado' : (intentos >= 3 ? 'no_aprobado' : 'en_curso');
    return {
      academicaId: r.academicaId, numeroId: r.numeroId, nombre: r.nombre || '(sin nombre)',
      code: r.code, step: r.step, cuestionarioId: r.cuestionarioId, titulo: r.titulo || 'Cuestionario',
      intentos, mejor: Number(r.mejor) || 0, aprobado, estado,
    };
  });

  // Columnas de cuestionarios (distintos) presentes en el resultado.
  const seen = new Set<string>();
  const cuestionarios = rows.filter(r => { const k = `${r.code}|${r.cuestionarioId}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(r => ({ code: r.code, step: r.step, cuestionarioId: r.cuestionarioId, titulo: r.titulo }));

  const aprobadosCount = rows.filter(r => r.aprobado).length;
  return successResponse({
    available: true, rows, cuestionarios, cursos, salones, curso, salon,
    resumen: {
      estudiantes: new Set(rows.map(r => r.academicaId)).size,
      cuestionariosAprobados: aprobadosCount, cuestionariosTotal: rows.length,
      aprobacionPct: rows.length ? Math.round(aprobadosCount * 100 / rows.length) : 0,
      promedioIntentos: rows.length ? Math.round(rows.reduce((a, r) => a + r.intentos, 0) / rows.length * 10) / 10 : 0,
    },
  });
});
