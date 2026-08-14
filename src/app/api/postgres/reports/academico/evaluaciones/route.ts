import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission } from '@/lib/api-permissions';
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
  await requireAnyPermission(session, [AcademicoPermission.EVALUACIONES_VER, AcademicoPermission.ENTRENAMIENTOS_VER]);
  const sp = new URL(request.url).searchParams;
  const curso = (sp.get('curso') || '').trim();
  const salon = (sp.get('salon') || '').trim();
  const code = (sp.get('code') || '').trim();
  const step = (sp.get('step') || '').trim();
  // Categoría del módulo: "Evaluación NN" vs "Entrenamiento NN". Es lo que separa
  // la pantalla de Evaluaciones de la de Entrenamientos; sin tipo, ambas.
  const tipo = (sp.get('tipo') || '').trim().toLowerCase();
  const filtroTipo = tipo === 'evaluacion' ? `AND er."code" ILIKE '%evaluac%'`
    : tipo === 'entrenamiento' ? `AND er."code" ILIKE '%entren%'`
    : '';

  // Catálogo de cursos: los de la plataforma, NO sólo los que ya tienen
  // resultados — si no, mientras nadie haya rendido una evaluación el selector
  // sale vacío y la pantalla no se puede usar. Se unen con los cursos que sí
  // tengan respuestas, por si alguno quedó fuera del catálogo activo.
  const cursos = (await query<{ curso: string }>(
    `SELECT DISTINCT curso FROM (
       SELECT "tipoCurso" AS curso FROM "CURSOS_CAMPAIGN" WHERE "activa" = true AND "tipoCurso" IS NOT NULL AND "tipoCurso" <> ''
       UNION
       SELECT "curso" FROM "EVALUACION_RESPUESTAS" WHERE "curso" IS NOT NULL AND "curso" <> ''
     ) x ORDER BY curso`
  )).rows.map(r => r.curso);

  if (!curso) return successResponse({ available: true, rows: [], cuestionarios: [], cursos, salones: [], curso: '', salon: '' });

  // Salones del curso elegido (del catálogo + los que tengan resultados).
  const salones = (await query<{ salon: string }>(
    `SELECT DISTINCT salon FROM (
       SELECT cc."salon" FROM "CURSOS_CAMPAIGN" cc
        WHERE cc."activa" = true AND UPPER(cc."tipoCurso") = UPPER($1) AND cc."salon" IS NOT NULL AND cc."salon" <> ''
       UNION
       SELECT p."salon" FROM "EVALUACION_RESPUESTAS" er
         JOIN "PEOPLE" p ON UPPER(p."numeroId") = UPPER(er."numeroId") AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
        WHERE UPPER(er."curso") = UPPER($1) AND p."salon" IS NOT NULL AND p."salon" <> ''
     ) x ORDER BY salon`,
    [curso]
  )).rows.map(r => r.salon);

  const where: string[] = [`UPPER(er."curso")=UPPER($1)`, `er."enviadaEn" IS NOT NULL`];
  const params: any[] = [curso];
  let join = '';
  if (filtroTipo) where.push(filtroTipo.replace(/^AND /, ''));
  if (code) { where.push(`er."code"=$${params.length + 1}`); params.push(code); }
  if (step) { where.push(`er."step"=$${params.length + 1}`); params.push(step); }
  if (salon) {
    join = `JOIN "PEOPLE" p ON UPPER(p."numeroId")=UPPER(er."numeroId") AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')`;
    where.push(`p."salon"=$${params.length + 1}`); params.push(salon);
  }

  // ARRAY_AGG(... ORDER BY intento DESC)[1] = el ÚLTIMO intento del estudiante en
  // ese cuestionario (hasta 3). Se devuelven sus aciertos/fallos para que el
  // reporte muestre "X correctas · Y incorrectas · Z%" sin otra consulta.
  const ult = (col: string) => `(ARRAY_AGG(er."${col}" ORDER BY er."intento" DESC NULLS LAST, er."enviadaEn" DESC NULLS LAST))[1]`;

  const raw = (await query<any>(
    `SELECT er."academicaId", er."numeroId", MAX(er."nombre") AS nombre, er."code", er."step",
            er."cuestionarioId", MAX(er."cuestionarioTitulo") AS titulo,
            COUNT(*)::int AS intentos, MAX(COALESCE(er."porcentaje",0))::int AS mejor,
            BOOL_OR(COALESCE(er."aprobado",false)) AS aprobado,
            ${ult('score')}      AS "ultScore",
            ${ult('total')}      AS "ultTotal",
            ${ult('porcentaje')} AS "ultPorcentaje",
            ${ult('aprobado')}   AS "ultAprobado",
            ${ult('intento')}    AS "ultIntento",
            ${ult('enviadaEn')}  AS "ultEnviadaEn"
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
    // Último intento: correctas / incorrectas / %.
    const correctas = Number(r.ultScore) || 0;
    const totalPreg = Number(r.ultTotal) || 0;
    return {
      academicaId: r.academicaId, numeroId: r.numeroId, nombre: r.nombre || '(sin nombre)',
      code: r.code, step: r.step, cuestionarioId: r.cuestionarioId, titulo: r.titulo || 'Cuestionario',
      intentos, mejor: Number(r.mejor) || 0, aprobado, estado,
      ultimo: {
        intento: Number(r.ultIntento) || intentos,
        correctas,
        incorrectas: Math.max(0, totalPreg - correctas),
        total: totalPreg,
        porcentaje: Number(r.ultPorcentaje) || 0,
        aprobado: !!r.ultAprobado,
        enviadaEn: r.ultEnviadaEn || null,
      },
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
