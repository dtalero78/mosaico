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

  // Filtro de categoría de módulo evaluable:
  //  ?tipo=evaluacion   → sólo módulos "Evaluación NN"
  //  ?tipo=entrenamiento→ sólo módulos "Entrenamiento NN"
  //  (sin tipo)         → ambos (comportamiento combinado histórico).
  //  ?tipo=leccion → cuestionarios de la LECCIÓN ACTUAL (curso+módulo+lección),
  //                  sin importar la categoría del módulo (IMPULSA: toda lección
  //                  puede traer cuestionarios). Siempre reached=true.
  const tipo = (new URL(_req.url).searchParams.get('tipo') || '').toLowerCase()
  const esLeccion = tipo === 'leccion'
  const catRegex = tipo === 'evaluacion' ? /evaluac/i : tipo === 'entrenamiento' ? /entren/i : /evaluac|entren/i
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
  const actualEsEval = esLeccion ? true : catRegex.test(nivel)

  const evals = (esLeccion
    ? await query(
        `SELECT "code","step","orden","evaluacionModo","evaluacionMinutos","preguntasManual","cuestionarios"
           FROM "NIVELES"
          WHERE UPPER("curso")=UPPER($1) AND ${norm('"code"')}=${norm('$2')} AND ${norm('"step"')}=${norm('$3')}
          LIMIT 1`,
        [curso, nivel, step]
      )
    : await query(
        `SELECT "code","step","orden","evaluacionModo","evaluacionMinutos","preguntasManual","cuestionarios"
           FROM "NIVELES"
          WHERE UPPER("curso")=UPPER($1) AND ${catSql}
          ORDER BY "orden" ASC`,
        [curso]
      )).rows as any[]

  if (actualEsEval) {
    const actual = esLeccion
      ? (evals[0] || null)
      : (evals.find(e => e.code === nivel && e.step === step) || evals.find(e => e.code === nivel))
    const cuestionarios = deriveCuestionarios(actual || {})
    const tieneEvaluacion = cuestionarios.length > 0

    const MAX_INTENTOS = 3
    const prev = (await query<{ cuestionarioId: string | null; porcentaje: number | null; aprobado: boolean | null; score: number; total: number }>(
      `SELECT "cuestionarioId","porcentaje","aprobado","score","total" FROM "EVALUACION_RESPUESTAS"
        WHERE "academicaId"=$1 AND "curso"=$2 AND "code"=$3 AND "step"=$4 AND "enviadaEn" IS NOT NULL`,
      [student.academicaId, curso, nivel, step]
    )).rows
    // Compat: filas antiguas sin cuestionarioId → cuentan como el primer cuestionario.
    const primerId = cuestionarios[0]?.id || 'c1'
    // Estado por cuestionario: intentos usados, mejor %, aprobado, agotado (3 sin aprobar).
    const estadoPorId: Record<string, { intentos: number; aprobado: boolean; mejor: number; agotado: boolean }> = {}
    for (const c of cuestionarios) estadoPorId[c.id] = { intentos: 0, aprobado: false, mejor: 0, agotado: false }
    for (const r of prev) {
      const id = r.cuestionarioId || primerId
      const e = estadoPorId[id]; if (!e) continue
      e.intentos++
      const pct = Number(r.porcentaje) || (Number(r.total) ? Math.round(Number(r.score) * 100 / Number(r.total)) : 0)
      if (pct > e.mejor) e.mejor = pct
      if (r.aprobado || pct >= 60) e.aprobado = true
    }
    for (const id of Object.keys(estadoPorId)) { const e = estadoPorId[id]; e.agotado = !e.aprobado && e.intentos >= MAX_INTENTOS }
    // "resuelto" = aprobado o agotó los intentos. La evaluación está completa si todos resueltos.
    const resuelto = (id: string) => estadoPorId[id].aprobado || estadoPorId[id].agotado
    const completa = tieneEvaluacion && cuestionarios.every(c => resuelto(c.id))

    // Guía del alumno (para el modal "sigue las instrucciones de tu guía, X").
    let guiaNombre = ''
    try {
      const g = await queryOne<{ nombre: string }>(
        `SELECT g."nombreCompleto" AS nombre FROM "CURSOS_CAMPAIGN" cc JOIN "GUIAS" g ON g."_id"=cc."guia"
          WHERE cc."campaign"=$1 AND UPPER(cc."tipoCurso")=UPPER($2) AND cc."salon"=$3 LIMIT 1`,
        [(student as any).campaign || '', curso, (student as any).salon || '']
      )
      guiaNombre = g?.nombre || ''
    } catch { guiaNombre = '' }

    return successResponse({
      available: true,
      reached: true,
      evalCode: nivel,
      evalNum: extraNum(nivel),
      tieneEvaluacion,
      cuestionarios: (tieneEvaluacion ? sanitizeCuestionarios(cuestionarios) : []).map((c) => ({
        ...c, ...estadoPorId[c.id], resuelto: resuelto(c.id), intentosMax: MAX_INTENTOS,
      })),
      completa,
      guiaNombre,
      aprobacionPct: 60,
      curso, code: nivel, step,
    })
  }

  const siguiente = currentOrden != null
    ? evals.find(e => e.orden != null && e.orden > currentOrden)
    : evals[0]
  const faltanLecciones = (siguiente?.orden != null && currentOrden != null)
    ? Math.max(0, Number(siguiente.orden) - Number(currentOrden))
    : null
  return successResponse({
    available: true,
    reached: false,
    evalCode: siguiente?.code || null,
    evalNum: siguiente ? extraNum(siguiente.code) : null,
    faltanLecciones,
  })
})
