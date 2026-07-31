import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { resolveStudentFromSession } from '@/services/panel-estudiante.service'
import { query, queryOne } from '@/lib/postgres'
import { deriveCuestionarios, sanitizeCuestionarios } from '@/lib/cuestionarios'

/**
 * GET /api/postgres/panel-estudiante/evaluacion
 *
 * Estado de la evaluación del alumno según su avance:
 *  - reached=false → la SIGUIENTE evaluación/entrenamiento por delante.
 *  - reached=true  → su lección actual ES evaluable: devuelve la LISTA de
 *    cuestionarios (SIN respuestas correctas), cuáles ya envió y si está completa.
 *    El alumno los presenta TODOS en orden.
 * Módulos evaluables: code ~ /evaluac|entren/i.
 */
const extraNum = (code: string) => { const m = String(code || '').match(/(\d+)/); return m ? m[1] : '' }

export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  const student: any = await resolveStudentFromSession(session)
  const curso = student.tipoCurso || student.curso || ''
  const nivel = student.nivel || ''   // módulo actual
  const step = student.step || ''     // lección actual
  if (!curso) return successResponse({ available: false })

  const cur = await queryOne<{ orden: number | null }>(
    `SELECT "orden" FROM "NIVELES" WHERE UPPER("curso")=UPPER($1) AND "code"=$2 AND "step"=$3 LIMIT 1`,
    [curso, nivel, step]
  )
  const currentOrden = cur?.orden ?? null
  const actualEsEval = /evaluac|entren/i.test(nivel)

  const evals = (await query(
    `SELECT "code","step","orden","evaluacionModo","evaluacionMinutos","preguntasManual","cuestionarios"
       FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1) AND ("code" ILIKE '%evaluac%' OR "code" ILIKE '%entren%')
      ORDER BY "orden" ASC`,
    [curso]
  )).rows as any[]

  if (actualEsEval) {
    const actual = evals.find(e => e.code === nivel && e.step === step) || evals.find(e => e.code === nivel)
    const cuestionarios = deriveCuestionarios(actual || {})
    const tieneEvaluacion = cuestionarios.length > 0

    const prev = (await query<{ cuestionarioId: string | null; score: number; total: number }>(
      `SELECT "cuestionarioId","score","total" FROM "EVALUACION_RESPUESTAS"
        WHERE "academicaId"=$1 AND "curso"=$2 AND "code"=$3 AND "step"=$4 AND "enviadaEn" IS NOT NULL`,
      [student.academicaId, curso, nivel, step]
    )).rows
    // Compat: filas antiguas sin cuestionarioId → cuentan como el primer cuestionario.
    const primerId = cuestionarios[0]?.id || 'c1'
    const enviadosIds = new Set(prev.map(r => r.cuestionarioId || primerId))
    const resultados = prev.map(r => ({ cuestionarioId: r.cuestionarioId || primerId, score: r.score, total: r.total }))
    const completa = tieneEvaluacion && cuestionarios.every(c => enviadosIds.has(c.id))

    return successResponse({
      available: true,
      reached: true,
      evalCode: nivel,
      evalNum: extraNum(nivel),
      tieneEvaluacion,
      cuestionarios: tieneEvaluacion ? sanitizeCuestionarios(cuestionarios) : [],
      enviados: Array.from(enviadosIds),
      resultados,
      completa,
      curso, code: nivel, step,
    })
  }

  const siguiente = currentOrden != null
    ? evals.find(e => e.orden != null && e.orden > currentOrden)
    : evals[0]
  return successResponse({
    available: true,
    reached: false,
    evalCode: siguiente?.code || null,
    evalNum: siguiente ? extraNum(siguiente.code) : null,
  })
})
