import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { resolveStudentFromSession } from '@/services/panel-estudiante.service'
import { query, queryOne } from '@/lib/postgres'
import { ValidationError } from '@/lib/errors'
import { deriveCuestionarios } from '@/lib/cuestionarios'

/**
 * POST /api/postgres/panel-estudiante/evaluacion/submit
 * Body: { cuestionarioId?, respuestas: [{ qId, selected }], iniciadaEn? }
 *
 * Califica en el servidor las respuestas del alumno para UN cuestionario de la
 * lección actual (Evaluación/Entrenamiento) y guarda el evento en
 * EVALUACION_RESPUESTAS. La respuesta correcta nunca sale al cliente.
 */
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

  const row = await queryOne<{ preguntasManual: any; evaluacionModo: string | null; evaluacionMinutos: number | null; cuestionarios: any }>(
    `SELECT "preguntasManual","evaluacionModo","evaluacionMinutos","cuestionarios" FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1) AND "code"=$2 AND "step"=$3 LIMIT 1`,
    [curso, nivel, step]
  )
  const cuestionarios = deriveCuestionarios(row || {})
  if (!cuestionarios.length) throw new ValidationError('No hay una evaluación generada para tu lección actual.')

  const cuestionarioId = body?.cuestionarioId ? String(body.cuestionarioId) : cuestionarios[0].id
  const cuest = cuestionarios.find(c => c.id === cuestionarioId)
  if (!cuest) throw new ValidationError('Cuestionario no encontrado en tu lección.')

  const APROBACION = 60, MAX_INTENTOS = 3

  // Intentos previos de ESTE cuestionario (compat: filas viejas con cuestionarioId NULL = primer cuestionario).
  const prevAtt = (await query<{ aprobado: boolean | null }>(
    `SELECT "aprobado" FROM "EVALUACION_RESPUESTAS"
      WHERE "academicaId"=$1 AND "curso"=$2 AND "code"=$3 AND "step"=$4
        AND ("cuestionarioId"=$5 OR ("cuestionarioId" IS NULL AND $5=$6)) AND "enviadaEn" IS NOT NULL`,
    [academicaId, curso, nivel, step, cuestionarioId, cuestionarios[0].id]
  )).rows
  if (prevAtt.some(r => r.aprobado)) throw new ValidationError('Ya aprobaste este cuestionario.')
  if (prevAtt.length >= MAX_INTENTOS) throw new ValidationError('Agotaste los 3 intentos de este cuestionario.')
  const intento = prevAtt.length + 1

  const preguntas = cuest.preguntas
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
  const porcentaje = total ? Math.round((score / total) * 100) : 0
  const aprobado = porcentaje >= APROBACION
  const enviadaEn = new Date()
  const duracionSeg = iniciadaEn ? Math.max(0, Math.round((enviadaEn.getTime() - iniciadaEn.getTime()) / 1000)) : null

  const id = `evr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  await query(
    `INSERT INTO "EVALUACION_RESPUESTAS"
       ("_id","academicaId","numeroId","nombre","curso","code","step","cuestionarioId","cuestionarioTitulo","respuestas","score","total","porcentaje","aprobado","intento","iniciadaEn","enviadaEn","duracionSeg")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, academicaId, numeroId, nombre, curso, nivel, step, cuestionarioId, cuest.titulo, JSON.stringify(detalle), score, total,
     porcentaje, aprobado, intento, iniciadaEn ? iniciadaEn.toISOString() : null, enviadaEn.toISOString(), duracionSeg]
  )

  const agotado = !aprobado && intento >= MAX_INTENTOS
  return successResponse({
    ok: true, score, total, porcentaje, aprobado, intento,
    intentosRestantes: aprobado ? 0 : Math.max(0, MAX_INTENTOS - intento),
    agotado, cuestionarioId,
  })
})
