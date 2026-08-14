import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { resolveStudentFromSession } from '@/services/panel-estudiante.service'
import { query, queryOne } from '@/lib/postgres'
import { deriveCuestionarios, sanitizeCuestionarios } from '@/lib/cuestionarios'

/**
 * GET /api/postgres/panel-estudiante/evaluacion/seguimiento?tipo=evaluacion|entrenamiento
 *
 * Historial del PROPIO alumno para el botón "Seguimiento" de las cajas
 * Entrenamientos / Evaluaciones del panel: un ítem por cuestionario del curso, con
 *   · el resultado del ÚLTIMO intento (porcentaje, acertadas y erradas) y su
 *     detalle pregunta por pregunta (para el modal imprimible), y
 *   · si le quedan intentos, las preguntas para poder presentarlo desde ahí.
 *
 * Se listan TODAS las lecciones evaluables del curso para que el alumno vea el
 * camino completo, pero sólo se DESBLOQUEAN las que ya presentó (se puede abrir
 * su intento). Las que alcanzó y aún no presentó traen `puedePresentar`; las
 * posteriores a su lección actual salen `bloqueado` — nunca se puede ver ni
 * presentar una evaluación futura.
 *
 * Las respuestas correctas NO salen de los cuestionarios pendientes
 * (sanitizeCuestionarios); del intento ya enviado sí, que es el feedback.
 */
const MAX_INTENTOS = 3
const APROBACION = 60

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  const student: any = await resolveStudentFromSession(session)
  const curso = student.tipoCurso || student.curso || ''
  const nivel = student.nivel || ''
  const step = student.step || ''
  const academicaId = student.academicaId || student._id
  if (!curso || !academicaId) return successResponse({ available: false, items: [] })

  const tipo = (new URL(req.url).searchParams.get('tipo') || '').toLowerCase()
  const catSql = tipo === 'evaluacion' ? `"code" ILIKE '%evaluac%'`
    : tipo === 'entrenamiento' ? `"code" ILIKE '%entren%'`
    : `("code" ILIKE '%evaluac%' OR "code" ILIKE '%entren%')`

  // Match tolerante a tildes/mayúsculas (el alumno puede tener "Leccion" y NIVELES "Lección").
  const norm = (c: string) => `translate(lower(${c}),'áéíóúñ','aeioun')`
  const cur = await queryOne<{ orden: number | null }>(
    `SELECT "orden" FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1) AND ${norm('"code"')}=${norm('$2')} AND ${norm('"step"')}=${norm('$3')} LIMIT 1`,
    [curso, nivel, step]
  )
  const currentOrden = cur?.orden ?? null

  const lecciones = (await query(
    `SELECT "code","step","orden","evaluacionModo","evaluacionMinutos","preguntasManual","cuestionarios"
       FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1) AND ${catSql}
      ORDER BY "orden" ASC`,
    [curso]
  )).rows as any[]

  // Todos los envíos del alumno en esas categorías (una consulta, no N).
  const envios = (await query<any>(
    `SELECT "code","step","cuestionarioId","cuestionarioTitulo","respuestas","score","total",
            "porcentaje","aprobado","intento","enviadaEn","duracionSeg"
       FROM "EVALUACION_RESPUESTAS"
      WHERE "academicaId"=$1 AND UPPER("curso")=UPPER($2) AND "enviadaEn" IS NOT NULL
      ORDER BY "intento" ASC, "enviadaEn" ASC`,
    [academicaId, curso]
  )).rows

  const enviosDe = (code: string, stp: string) => envios.filter(e => e.code === code && e.step === stp)

  const items: any[] = []
  for (const lec of lecciones) {
    const cuestionarios = deriveCuestionarios(lec)
    const delLec = enviosDe(lec.code, lec.step)
    // Alcanzada = su orden no supera al de la lección actual. Si por lo que sea
    // tiene respuestas de una posterior (p. ej. lo movieron de módulo), se
    // muestra igual: el historial es suyo.
    const alcanzada = (currentOrden != null && lec.orden != null && Number(lec.orden) <= Number(currentOrden)) || delLec.length > 0
    // Se listan TODAS (sin `continue` por alcanzada) para que vea el camino
    // completo; las no alcanzadas van bloqueadas y sin preguntas.
    if (!cuestionarios.length) continue

    const primerId = cuestionarios[0].id
    const sanit = sanitizeCuestionarios(cuestionarios)

    cuestionarios.forEach((c, i) => {
      // Compat: filas antiguas sin cuestionarioId cuentan como el primer cuestionario.
      const intentos = delLec.filter(e => (e.cuestionarioId || primerId) === c.id)
      const aprobado = intentos.some(e => e.aprobado || Number(e.porcentaje) >= APROBACION)
      const agotado = !aprobado && intentos.length >= MAX_INTENTOS
      const mejor = intentos.reduce((m, e) => Math.max(m, Number(e.porcentaje) || 0), 0)
      const ult = intentos.length ? intentos[intentos.length - 1] : null
      const correctas = ult ? Number(ult.score) || 0 : 0
      const totalPreg = ult ? Number(ult.total) || 0 : 0
      const puedePresentar = alcanzada && !aprobado && intentos.length < MAX_INTENTOS && (sanit[i]?.preguntas?.length || 0) > 0

      items.push({
        code: lec.code,
        step: lec.step,
        orden: lec.orden,
        cuestionarioId: c.id,
        titulo: c.titulo,
        minutos: c.minutos,
        intentos: intentos.length,
        intentosMax: MAX_INTENTOS,
        mejor,
        aprobado,
        agotado,
        // "presentado" = tiene al menos un envío; es lo único que se DESBLOQUEA
        // (se puede abrir su intento). `bloqueado` = lección aún no alcanzada.
        presentado: intentos.length > 0,
        alcanzada,
        bloqueado: !alcanzada,
        puedePresentar,
        // Preguntas SIN respuesta correcta, sólo si puede presentarlo desde aquí.
        preguntas: puedePresentar ? (sanit[i]?.preguntas || []) : [],
        ultimo: ult ? {
          intento: Number(ult.intento) || intentos.length,
          correctas,
          incorrectas: Math.max(0, totalPreg - correctas),
          total: totalPreg,
          porcentaje: Number(ult.porcentaje) || 0,
          aprobado: !!ult.aprobado,
          enviadaEn: ult.enviadaEn || null,
          duracionSeg: ult.duracionSeg ?? null,
          respuestas: Array.isArray(ult.respuestas) ? ult.respuestas : [],
        } : null,
        historial: intentos.map(e => ({
          intento: Number(e.intento) || 0,
          score: Number(e.score) || 0,
          total: Number(e.total) || 0,
          porcentaje: Number(e.porcentaje) || 0,
          aprobado: !!e.aprobado,
          enviadaEn: e.enviadaEn || null,
        })),
      })
    })
  }

  // Orden del currículo (Evaluación 01, 02, …): se ve el camino completo, con lo
  // ya presentado arriba y lo que falta debajo.
  items.sort((a, b) => (Number(a.orden ?? 0) - Number(b.orden ?? 0)) || String(a.titulo).localeCompare(String(b.titulo)))

  const nombre = [student.primerNombre, student.segundoNombre, student.primerApellido, student.segundoApellido]
    .filter(Boolean).join(' ').trim()

  return successResponse({
    available: true,
    tipo,
    curso,
    estudiante: { nombre, numeroId: student.numeroId || null },
    aprobacionPct: APROBACION,
    intentosMax: MAX_INTENTOS,
    items,
  })
})
