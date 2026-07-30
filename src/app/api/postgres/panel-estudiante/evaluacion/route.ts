import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { resolveStudentFromSession } from '@/services/panel-estudiante.service'
import { query, queryOne } from '@/lib/postgres'

/**
 * GET /api/postgres/panel-estudiante/evaluacion
 *
 * Estado de la evaluación del alumno según su avance:
 *  - reached=false → la SIGUIENTE evaluación por delante (módulo Evaluación NN).
 *  - reached=true  → su lección actual ES una Evaluación: devuelve las preguntas
 *    (SIN la respuesta correcta) + si ya la envió (una vez) + duración (30 min).
 * Los módulos de evaluación se detectan por code ~ /evaluac/i.
 */
const extraNum = (code: string) => { const m = String(code || '').match(/(\d+)/); return m ? m[1] : '' }

function parseQs(preguntas: any): any[] {
  try {
    const arr = Array.isArray(preguntas) ? preguntas : (typeof preguntas === 'string' ? JSON.parse(preguntas || '[]') : [])
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
/** Preguntas para el alumno: SIN correctAnswer ni explicación. */
function sanitize(preguntas: any): any[] {
  return parseQs(preguntas).map((q: any, i: number) => ({
    id: q.id ?? i,
    type: q.type || 'multiple_choice',
    question: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
  }))
}

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
  const actualEsEval = /evaluac/i.test(nivel)

  const evals = (await query(
    `SELECT "code","step","orden","evaluacionModo",
            (COALESCE("preguntasManual"::text,'[]') NOT IN ('[]','null')) AS "tienePreguntas",
            "preguntasManual"
       FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1) AND "code" ILIKE '%evaluac%'
      ORDER BY "orden" ASC`,
    [curso]
  )).rows as any[]

  if (actualEsEval) {
    const actual = evals.find(e => e.code === nivel && e.step === step) || evals.find(e => e.code === nivel)
    const tieneEvaluacion = !!actual?.tienePreguntas && String(actual?.evaluacionModo).toUpperCase() === 'MANUAL'

    const prev = await queryOne<{ score: number; total: number; enviadaEn: string }>(
      `SELECT "score","total","enviadaEn" FROM "EVALUACION_RESPUESTAS"
        WHERE "academicaId"=$1 AND "curso"=$2 AND "code"=$3 AND "step"=$4 AND "enviadaEn" IS NOT NULL
        ORDER BY "enviadaEn" DESC LIMIT 1`,
      [student.academicaId, curso, nivel, step]
    )

    return successResponse({
      available: true,
      reached: true,
      evalCode: nivel,
      evalNum: extraNum(nivel),
      tieneEvaluacion,
      yaEnviada: !!prev,
      resultado: prev || null,
      duracionMin: 30,
      curso, code: nivel, step,
      preguntas: tieneEvaluacion ? sanitize(actual?.preguntasManual) : [],
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
