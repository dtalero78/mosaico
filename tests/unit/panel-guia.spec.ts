import { test, expect } from '@playwright/test'
import {
  notaChilena, calcularAlertas, compararFilas, estadoFila, tonoAsistencia, tonoNota, tonoCriterio,
  type Alerta,
} from '../../src/lib/reglas-alertas-guia'
import {
  calcularMetricas, construirFilas, resumirCurso,
  type AlumnoCrudo, type BookingCrudo, type CursoCrudo, type FilaMetricas,
} from '../../src/lib/resumen-guia'
import { puedeVerPanelGuia } from '../../src/lib/alcance-guia'

/**
 * Panel del guía: las reglas de alertas, el orden de las filas y el cálculo de
 * las métricas a partir de los datos crudos.
 */

const NOW = new Date('2026-10-17T15:00:00Z')

const curso = (over: Partial<CursoCrudo> = {}): CursoCrudo => ({
  cursoId: 'ccp_1', campaign: 'AGOSTO172026M', tipoCurso: 'KODOMO', horarioCurso: 'LUN-MIÉ 17:00-18:00',
  salon: '01', inicioCurso: '2026-08-17', finalCurso: '2027-06-17', inicioCampanaCursos: '2026-08-17',
  numeroUsuarios: 12, eventosPasados: [], leccionesPrograma: 60,
  cuestionariosEval: { 'evaluacion 01||leccion 25': ['c1', 'c2'] },
  ...over,
})

let n = 0
const bk = (over: Partial<BookingCrudo> = {}): BookingCrudo => ({
  dia: `2026-09-${String(1 + (n++ % 28)).padStart(2, '0')}T22:30:00Z`,
  sm: 'Modulo 01', sl: `Leccion ${n}`, sm2: null, sl2: null,
  cerrada: true, asistio: false, asistencia: false, cancelo: false, noAprobo: false, escusa: false, rubrica: null,
  crit: {}, ...over,
})

const alumno = (over: Partial<AlumnoCrudo> = {}): AlumnoCrudo => ({
  peopleId: 'prs_1', academicaId: 'acd_1', numeroId: '1',
  primerNombre: 'Ana', segundoNombre: null, primerApellido: 'Rojas', segundoApellido: null,
  nivelacionHistory: [], nivelacionViva: false, bookings: [], casos: [], evals: [], notas: [],
  ...over,
})

const metricasVacias = (): FilaMetricas => ({
  asistencia: { presentes: 0, faltas: 0, justificadas: 0, sinMarcar: 0, sesiones: 0, pct: null, faltasSeguidas: 0, ultimaAsistencia: null },
  lecciones: { vistas: 0, dictadas: 0, sinVer: 0, totalPrograma: 60 },
  nivelaciones: { realizadas: 0, ultima: null, enCurso: false },
  casos: { abiertos: 0, total: 0 },
  evaluaciones: { dictadas: 0, rendidas: 0, pendientes: 0, promedio: null, minima: null },
  criterios: { H: null, D: null, A: null },
})

// ─── Nota chilena ──────────────────────────────────────────────────────────────

test('la nota usa escala chilena con exigencia del 60%', () => {
  expect(notaChilena(0)).toBe(1)
  expect(notaChilena(30)).toBe(2.5)
  expect(notaChilena(60)).toBe(4)
  expect(notaChilena(80)).toBe(5.5)
  expect(notaChilena(100)).toBe(7)
  // 59% es un cuestionario reprobado: nunca puede mostrarse como 4,0.
  expect(notaChilena(59)).toBe(3.9)
})

test('colores de las métricas en sus bordes', () => {
  expect(tonoAsistencia(74)).toBe('risk')
  expect(tonoAsistencia(75)).toBe('warn')
  expect(tonoAsistencia(84)).toBe('warn')
  expect(tonoAsistencia(85)).toBe('ok')
  expect(tonoAsistencia(null)).toBe('none')
  expect(tonoNota(3.9)).toBe('risk')
  expect(tonoNota(4.0)).toBe('warn')
  expect(tonoNota(4.9)).toBe('warn')
  expect(tonoNota(5.0)).toBe('ok')
  expect(tonoCriterio(59)).toBe('risk')
  expect(tonoCriterio(60)).toBe('warn')
  expect(tonoCriterio(75)).toBe('ok')
})

// ─── Alertas ───────────────────────────────────────────────────────────────────

test('sin datos no hay alertas', () => {
  expect(calcularAlertas(metricasVacias())).toEqual([])
})

test('cada regla dispara en su umbral y no antes', () => {
  const m = metricasVacias()
  m.asistencia.pct = 75; m.asistencia.faltasSeguidas = 1
  m.evaluaciones.promedio = 4.0; m.lecciones.sinVer = 2
  expect(calcularAlertas(m)).toEqual([])

  m.asistencia.pct = 74; m.asistencia.faltasSeguidas = 2; m.casos.abiertos = 1
  m.evaluaciones.promedio = 3.9; m.evaluaciones.pendientes = 1; m.lecciones.sinVer = 3
  expect(calcularAlertas(m).map(a => a.codigo)).toEqual([
    'ASISTENCIA_BAJA', 'FALTAS_SEGUIDAS', 'CASO_ABIERTO', 'PROMEDIO_BAJO',
    'EVALUACION_PENDIENTE', 'LECCIONES_SIN_VER',
  ])
})

test('las rojas van antes que las ámbar y la etiqueta lleva la cifra', () => {
  const m = metricasVacias()
  m.lecciones.sinVer = 4
  m.evaluaciones.promedio = 3.6
  const al = calcularAlertas(m)
  expect(al.map(a => a.severidad)).toEqual(['risk', 'warn'])
  // Etiquetas cortas como en el diseño; la cifra va en el detalle.
  expect(al[0]).toMatchObject({ etiqueta: 'Nota', detalle: 'Promedio 3,6 (menos de 4,0)' })
  expect(al[1]).toMatchObject({ etiqueta: 'Requiere nivelación', detalle: '4 lecciones dictadas sin ver' })
  expect(estadoFila(al)).toBe('risk')
  expect(estadoFila([al[1]])).toBe('warn')
  expect(estadoFila([])).toBe('ok')
})

// ─── Orden de las filas ────────────────────────────────────────────────────────

test('orden: con alertas, luego más rojas, luego apellido', () => {
  const r: Alerta = { codigo: 'CASO_ABIERTO', severidad: 'risk', etiqueta: 'x', detalle: 'x' }
  const w: Alerta = { codigo: 'LECCIONES_SIN_VER', severidad: 'warn', etiqueta: 'y', detalle: 'y' }
  const filas = [
    { primerApellido: 'Zúñiga', primerNombre: 'A', alertas: [] },
    { primerApellido: 'Álvarez', primerNombre: 'B', alertas: [] },
    { primerApellido: 'Muñoz', primerNombre: 'C', alertas: [w] },
    { primerApellido: 'Bravo', primerNombre: 'D', alertas: [r] },
    { primerApellido: 'Castro', primerNombre: 'E', alertas: [r, r] },
    { primerApellido: 'Araya', primerNombre: 'F', alertas: [r] },
  ]
  expect(filas.sort(compararFilas).map(f => f.primerApellido)).toEqual(
    ['Castro', 'Araya', 'Bravo', 'Muñoz', 'Álvarez', 'Zúñiga'],
  )
})

// ─── Métricas ──────────────────────────────────────────────────────────────────

test('asistencia: sin marcar y justificadas quedan fuera del porcentaje', () => {
  const m = calcularMetricas(alumno({ bookings: [
    bk({ asistio: true }), bk({ asistio: true }), bk({ asistio: true }),
    bk(),                                   // falta (sesión cerrada, no asistió)
    bk({ escusa: true }),                   // justificada
    bk({ cerrada: false }),                 // sin marcar
    bk({ cancelo: true }),                  // cancelada: no cuenta
    bk({ dia: '2026-12-01T22:30:00Z' }),    // futura: no cuenta
  ] }), curso(), NOW)
  expect(m.asistencia).toMatchObject({ presentes: 3, faltas: 1, justificadas: 1, sinMarcar: 1, sesiones: 4, pct: 75 })
})

test('faltas seguidas: la racha más reciente; justificada y sin marcar no la cortan', () => {
  const dias = (d: number) => `2026-10-${String(d).padStart(2, '0')}T22:30:00Z`
  const m = calcularMetricas(alumno({ bookings: [
    bk({ dia: dias(1), asistio: true }),
    bk({ dia: dias(2) }),
    bk({ dia: dias(3), escusa: true }),
    bk({ dia: dias(4) }),
    bk({ dia: dias(5), cerrada: false }),
  ] }), curso(), NOW)
  expect(m.asistencia.faltasSeguidas).toBe(2)
  expect(m.asistencia.ultimaAsistencia).toBe(dias(1))

  const m2 = calcularMetricas(alumno({ bookings: [bk({ dia: dias(1) }), bk({ dia: dias(2), asistio: true })] }), curso(), NOW)
  expect(m2.asistencia.faltasSeguidas).toBe(0)
})

test('lecciones: excluye evaluaciones y cuenta las dos de un bloque de sábado', () => {
  const m = calcularMetricas(alumno({ bookings: [
    bk({ asistio: true, sl: 'Leccion 02', sl2: 'Leccion 03', sm2: 'Modulo 01' }),
    bk({ sl: 'Leccion 04' }),
    bk({ asistio: true, sl: 'Leccion 05', noAprobo: true }),
    bk({ asistio: true, sm: 'Modulo 01', sl: 'Evaluación' }),
    bk({ asistio: true, sm: 'Evaluacion 01', sl: 'Leccion 25' }),
  ] }), curso(), NOW)
  expect(m.lecciones).toMatchObject({ dictadas: 4, vistas: 2, sinVer: 2, totalPrograma: 60 })
})

test('lecciones: la falta justificada cuenta como vista sólo en IMPULSA', () => {
  const datos = alumno({ bookings: [bk({ sl: 'Leccion 01', escusa: true })] })
  expect(calcularMetricas(datos, curso(), NOW).lecciones.vistas).toBe(0)
  expect(calcularMetricas(datos, curso({ tipoCurso: 'IMPULSA' }), NOW).lecciones.vistas).toBe(1)
})

test('evaluaciones: mejor intento por cuestionario, en nota chilena, y pendientes', () => {
  const m = calcularMetricas(alumno({
    bookings: [bk({ asistio: true, sm: 'Evaluacion 01', sl: 'Leccion 25' })],
    evals: [
      { curso: 'KODOMO', code: 'Evaluacion 01', step: 'Leccion 25', cuestionarioId: 'c1', porcentaje: 40 },
      { curso: 'KODOMO', code: 'Evaluacion 01', step: 'Leccion 25', cuestionarioId: 'c1', porcentaje: 80 },
      { curso: 'OKINA', code: 'Evaluacion 01', step: 'Leccion 25', cuestionarioId: 'c2', porcentaje: 100 },
    ],
  }), curso(), NOW)
  expect(m.evaluaciones).toMatchObject({ dictadas: 2, rendidas: 1, pendientes: 1, promedio: 5.5, minima: 5.5 })
})

test('evaluaciones: una clase de la carga histórica no cuenta como dictada', () => {
  const m = calcularMetricas(alumno({
    bookings: [bk({ asistio: true, carga: true, sm: 'Evaluacion 01', sl: 'Leccion 25' })],
  }), curso(), NOW)
  expect(m.evaluaciones).toMatchObject({ dictadas: 0, pendientes: 0 })
  // …pero la asistencia de esa clase sí cuenta.
  expect(m.asistencia.presentes).toBe(1)
})

test('evaluaciones: sin rendir no hay promedio', () => {
  const m = calcularMetricas(alumno(), curso(), NOW)
  expect(m.evaluaciones).toMatchObject({ dictadas: 0, rendidas: 0, pendientes: 0, promedio: null, minima: null })
})

test('casos: abiertos incluye los derivados a un área; se acotan al período del curso', () => {
  const m = calcularMetricas(alumno({ casos: [
    { estado: 'EN_GESTION', abiertoEn: '2026-09-10T12:00:00Z' },
    { estado: 'REMITIDO_A_NIVELACION', abiertoEn: '2026-09-11T12:00:00Z' },
    { estado: 'PROCESO_DE_CIERRE', abiertoEn: '2026-09-12T12:00:00Z' },
    { estado: 'RESUELTO', abiertoEn: '2026-09-13T12:00:00Z' },
    { estado: 'EN_GESTION', abiertoEn: '2026-05-01T12:00:00Z' },   // de otro curso
  ] }), curso(), NOW)
  expect(m.casos).toEqual({ abiertos: 3, total: 4 })
})

test('nivelaciones: sólo las realizadas del período, con la última fecha', () => {
  const m = calcularMetricas(alumno({ nivelacionViva: true, nivelacionHistory: [
    { resultado: 'REALIZADA', fechaEvento: '2026-09-11T20:00:00Z' },
    { resultado: 'REALIZADA', fechaEvento: '2026-10-02T22:00:00Z' },
    { resultado: 'NO_ASISTIO', fechaEvento: '2026-10-09T22:00:00Z' },
    { resultado: 'REALIZADA', fechaEvento: '2026-06-01T22:00:00Z' },
  ] }), curso(), NOW)
  expect(m.nivelaciones).toEqual({ realizadas: 2, ultima: '2026-10-02T22:00:00Z', enCurso: true })
})

test('criterios: rúbrica sin evaluar no cuenta, y la corrección manual manda en su semana', () => {
  const m = calcularMetricas(alumno({
    bookings: [
      // semana del 14-sep: 2 sesiones evaluadas, puntual en una
      bk({ dia: '2026-09-14T22:30:00Z', asistio: true, rubrica: true, crit: { puntual: true, asignacion: true, dominio: true } }),
      bk({ dia: '2026-09-16T22:30:00Z', asistio: true, rubrica: true, crit: { asignacion: true, dominio: true } }),
      // sin rúbrica evaluada: no aplica
      bk({ dia: '2026-09-21T22:30:00Z', asistio: true, rubrica: null, crit: {} }),
      // semana del 28-sep: 1 sesión evaluada sin nada marcado
      bk({ dia: '2026-09-28T22:30:00Z', asistio: true, rubrica: true, crit: {} }),
    ],
    // En la semana del 28-sep Coordinación corrigió Hábitos a "cumplió todas".
    notas: [{ salon: '01', campaign: 'AGOSTO172026M', semanaInicio: '2026-09-28', criterios: { puntual: 'full', asignacion: 'full' } }],
  }), curso(), NOW)
  // H = puntual 1/2 + asignación 2/2 + (manual) 1 + 1 → 5 de 6 = 83%
  expect(m.criterios.H).toBe(83)
  // D = dominio 2/2, participó 0/2, desafío 0/2, semana 28: 0/1 ×3 → 2 de 9 = 22%
  expect(m.criterios.D).toBe(22)
})

test('criterios: sin ninguna sesión evaluada no hay porcentaje', () => {
  const m = calcularMetricas(alumno({ bookings: [bk({ asistio: true })] }), curso(), NOW)
  expect(m.criterios).toEqual({ H: null, D: null, A: null })
})

test('filas y resumen del curso', () => {
  const c = curso({ eventosPasados: [
    { dia: '2026-09-01T22:30:00Z', sm: 'Modulo 01', sl: 'Leccion 02', sm2: null, sl2: null },
    { dia: '2026-09-03T22:30:00Z', sm: 'Evaluacion 01', sl: 'Leccion 25', sm2: null, sl2: null },
    { dia: '2026-09-08T22:30:00Z', sm: 'Modulo 02', sl: 'Leccion 10', sm2: null, sl2: null },
  ] })
  const filas = construirFilas([
    alumno({ primerApellido: 'Bravo', bookings: [bk({ asistio: true }), bk({ asistio: true })] }),
    alumno({ primerApellido: 'Araya', casos: [{ estado: 'EN_GESTION', abiertoEn: '2026-09-10T12:00:00Z' }] }),
  ], c, NOW)
  expect(filas.map(f => f.nombre)).toEqual(['Araya, Ana', 'Bravo, Ana'])
  const r = resumirCurso(filas, c)
  expect(r).toMatchObject({
    alumnos: 2, conAlertas: 1, asistenciaMedia: 100, sesionesDictadas: 3,
    leccionesDictadas: 2, moduloActual: 'Modulo 02', evaluacionesDictadas: 2, casosAbiertos: 1,
  })
})

// ─── Acceso al panel ───────────────────────────────────────────────────────────

test('acceso: el guía sólo ve su propio panel, aunque su rol tuviera "ver todos"', () => {
  expect(puedeVerPanelGuia({ esGuia: true, verTodos: false, guiaDeSesion: 'g_ana', guiaPedido: 'g_ana' })).toBe(true)
  expect(puedeVerPanelGuia({ esGuia: true, verTodos: false, guiaDeSesion: 'g_ana', guiaPedido: 'g_lea' })).toBe(false)
  expect(puedeVerPanelGuia({ esGuia: true, verTodos: true, guiaDeSesion: 'g_ana', guiaPedido: 'g_lea' })).toBe(false)
  // Guía sin ficha en GUIAS: nunca ve nada.
  expect(puedeVerPanelGuia({ esGuia: true, verTodos: false, guiaDeSesion: null, guiaPedido: 'g_ana' })).toBe(false)
})

test('acceso: Coordinación con "ver todos" elige cualquier guía; sin él, sólo el propio', () => {
  expect(puedeVerPanelGuia({ esGuia: false, verTodos: true, guiaDeSesion: null, guiaPedido: 'g_lea' })).toBe(true)
  expect(puedeVerPanelGuia({ esGuia: false, verTodos: false, guiaDeSesion: null, guiaPedido: 'g_lea' })).toBe(false)
  expect(puedeVerPanelGuia({ esGuia: false, verTodos: false, guiaDeSesion: 'g_lea', guiaPedido: 'g_lea' })).toBe(true)
  expect(puedeVerPanelGuia({ esGuia: false, verTodos: true, guiaDeSesion: null, guiaPedido: '' })).toBe(false)
})
