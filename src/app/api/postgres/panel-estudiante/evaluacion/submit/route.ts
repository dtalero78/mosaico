import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { resolveStudentFromSession } from '@/services/panel-estudiante.service'
import { query, queryOne } from '@/lib/postgres'
import { ValidationError } from '@/lib/errors'

/**
 * POST /api/postgres/panel-estudiante/evaluacion/submit
 * Body: { respuestas: [{ qId, selected }], iniciadaEn? }
 *
 * Recibe las respuestas del alumno de la evaluación de su lección ACTUAL (módulo
 * Evaluación), las CALIFICA en el servidor (contra NIVELES.preguntasManual) y
 * guarda el evento + respuestas en EVALUACION_RESPUESTAS. La respuesta correcta
 * nunca sale al cliente.
 */
function parseQs(preguntas: any): any[] {
  try {
    const arr = Array.isArray(preguntas) ? preguntas : (typeof preguntas === 'string' ? JSON.parse(preguntas || '[]') : [])
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  const student: any = await resolveStudentFromSession(session)
  const curso = student.tipoCurso || student.curso || ''
  const nivel = student.nivel || ''
  const step = student.step || ''
  const academicaId = student.academicaId || student._id
  const numeroId = student.numeroId || null
  const nombre = [student.primerNombre, student.segundoNombre, student.primerApellido, student.segundoApellido]
    .filter(Boolean).join(' ').trim() || null

  if (!curso || !/evaluac|entren/i.test(nivel)) {
    throw new ValidationError('Tu lección actual no es una evaluación.')
  }

  const body = await req.json().catch(() => ({}))
  const respuestasIn: Array<{ qId: any; selected: any }> = Array.isArray(body?.respuestas) ? body.respuestas : []
  const iniciadaEn = body?.iniciadaEn ? new Date(body.iniciadaEn) : null

  const row = await queryOne<{ preguntasManual: any; evaluacionModo: string | null }>(
    `SELECT "preguntasManual","evaluacionModo" FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1) AND "code"=$2 AND "step"=$3 LIMIT 1`,
    [curso, nivel, step]
  )
  const preguntas = parseQs(row?.preguntasManual)
  if (String(row?.evaluacionModo).toUpperCase() !== 'MANUAL' || !preguntas.length) {
    throw new ValidationError('No hay una evaluación generada para tu lección actual.')
  }

  // Calificación server-side
  let score = 0
  const detalle = preguntas.map((q: any, i: number) => {
    const qId = q.id ?? i
    const found = respuestasIn.find((r) => String(r.qId) === String(qId))
    const selected = found ? found.selected : null
    const ok = selected != null && String(selected) === String(q.correctAnswer ?? '')
    if (ok) score++
    return { qId, question: q.question ?? '', selected, correct: q.correctAnswer ?? '', ok }
  })
  const total = preguntas.length
  const enviadaEn = new Date()
  const duracionSeg = iniciadaEn ? Math.max(0, Math.round((enviadaEn.getTime() - iniciadaEn.getTime()) / 1000)) : null

  const id = `evr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  await query(
    `INSERT INTO "EVALUACION_RESPUESTAS"
       ("_id","academicaId","numeroId","nombre","curso","code","step","respuestas","score","total","iniciadaEn","enviadaEn","duracionSeg")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
    [id, academicaId, numeroId, nombre, curso, nivel, step, JSON.stringify(detalle), score, total,
     iniciadaEn ? iniciadaEn.toISOString() : null, enviadaEn.toISOString(), duracionSeg]
  )

  return successResponse({ ok: true, score, total })
})
