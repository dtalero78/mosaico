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
    // Un módulo evaluable puede repartir su contenido en VARIAS lecciones (en
    // IMPULSA, "Entrenamiento 01" son las lecciones 06 y 07, que se ven en una
    // misma clase). El alumno no avanza de lección dentro del módulo —el avance
    // automático salta de módulo a módulo—, así que mirar sólo su lección dejaba
    // los cuestionarios de las demás fuera de su alcance para siempre.
    // Se ofrecen los del MÓDULO entero, en orden de lección, y cada uno recuerda
    // de qué lección viene para calificarlo contra ella.
    const filasModulo = esLeccion
      ? (evals[0] ? [evals[0]] : [])
      : evals.filter(e => e.code === nivel).sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    const cuestionarios = filasModulo.flatMap((fila: any) =>
      deriveCuestionarios(fila).map(c => ({ ...c, code: fila.code as string, step: fila.step as string }))
    )
    const tieneEvaluacion = cuestionarios.length > 0

    const MAX_INTENTOS = 3
    const prev = (await query<{ step: string; cuestionarioId: string | null; porcentaje: number | null; aprobado: boolean | null; score: number; total: number }>(
      `SELECT "step","cuestionarioId","porcentaje","aprobado","score","total" FROM "EVALUACION_RESPUESTAS"
        WHERE "academicaId"=$1 AND "curso"=$2 AND "code"=$3 AND "enviadaEn" IS NOT NULL`,
      [student.academicaId, curso, nivel]
    )).rows
    // Compat: filas antiguas sin cuestionarioId → cuentan como el primer cuestionario.
    // La clave lleva la LECCIÓN: dos lecciones del mismo módulo pueden traer cada
    // una un cuestionario "c1", y con la clave a secas se pisarían entre ellas.
    const clave = (stepC: string, id: string) => `${stepC}::${id}`
    const primerIdDe = (stepC: string) => cuestionarios.find(c => c.step === stepC)?.id || 'c1'
    const estadoPorId: Record<string, { intentos: number; aprobado: boolean; mejor: number; agotado: boolean }> = {}
    for (const c of cuestionarios) estadoPorId[clave(c.step, c.id)] = { intentos: 0, aprobado: false, mejor: 0, agotado: false }
    for (const r of prev) {
      const id = r.cuestionarioId || primerIdDe(r.step)
      const e = estadoPorId[clave(r.step, id)]; if (!e) continue
      e.intentos++
      const pct = Number(r.porcentaje) || (Number(r.total) ? Math.round(Number(r.score) * 100 / Number(r.total)) : 0)
      if (pct > e.mejor) e.mejor = pct
      if (r.aprobado || pct >= 60) e.aprobado = true
    }
    for (const k of Object.keys(estadoPorId)) { const e = estadoPorId[k]; e.agotado = !e.aprobado && e.intentos >= MAX_INTENTOS }
    // "resuelto" = aprobado o agotó los intentos. El módulo está completo si lo están todos.
    const resuelto = (c: { step: string; id: string }) => {
      const e = estadoPorId[clave(c.step, c.id)]
      return !!e && (e.aprobado || e.agotado)
    }
    const completa = tieneEvaluacion && cuestionarios.every(resuelto)

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
      cuestionarios: (tieneEvaluacion ? sanitizeCuestionarios(cuestionarios) : []).map((c: any, i) => ({
        ...c,
        // `code`/`step` viajan de vuelta al enviarlo: así se califica contra su
        // propia lección y no contra la que el alumno tenga marcada.
        code: cuestionarios[i].code, step: cuestionarios[i].step,
        ...estadoPorId[clave(cuestionarios[i].step, cuestionarios[i].id)],
        resuelto: resuelto(cuestionarios[i]), intentosMax: MAX_INTENTOS,
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
