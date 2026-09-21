import { test, expect } from '@playwright/test'
import { calcularFechasCurso, fechasAmpliacion, addDaysISO } from '../../src/lib/calendario-curso'

/**
 * Qué días tiene clase un curso, y qué agregan / quitan Cierre y Ampliación
 * (Académico › Campañas › Ajuste Cursos).
 *
 * Lo que se fija es lo que se confunde:
 *  - el nº de clases lo da la ventana NOMINAL [inicio, fin]; una clase que cae en
 *    festivo no se pierde: se corre al final, después de `fin`;
 *  - `hasta` (el tope de un cierre) corta también esas clases corridas: sin él,
 *    regenerar un curso cerrado volvería a crear clases después del cierre;
 *  - AMPLIAR agregando sólo lo que falta después de la última clase da EXACTAMENTE
 *    el mismo calendario que regenerar el curso entero con el nuevo final. Si no,
 *    la próxima regeneración movería clases ya agendadas.
 */

const LUN_MIE = [1, 3]
const sinFestivos = () => false

test('sin festivos: una clase por día-clase del horario en la ventana', () => {
  // Lunes 7 y miércoles 9, lunes 14 y miércoles 16 de septiembre de 2026.
  expect(calcularFechasCurso({ inicio: '2026-09-07', fin: '2026-09-16', dias: LUN_MIE, noHayClase: sinFestivos }))
    .toEqual(['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'])
})

test('la clase que cae en festivo se corre al final, no se pierde', () => {
  const festivo = (d: string) => d === '2026-09-14'
  expect(calcularFechasCurso({ inicio: '2026-09-07', fin: '2026-09-16', dias: LUN_MIE, noHayClase: festivo }))
    .toEqual(['2026-09-07', '2026-09-09', '2026-09-16', '2026-09-21'])
})

test('varios festivos seguidos: se corren todos, saltando también los que caen después', () => {
  const festivos = new Set(['2026-09-14', '2026-09-16', '2026-09-21'])
  expect(calcularFechasCurso({ inicio: '2026-09-07', fin: '2026-09-16', dias: LUN_MIE, noHayClase: d => festivos.has(d) }))
    .toEqual(['2026-09-07', '2026-09-09', '2026-09-23', '2026-09-28'])
})

test('el tope de un cierre corta también las clases corridas por festivo', () => {
  const festivo = (d: string) => d === '2026-09-14'
  expect(calcularFechasCurso({ inicio: '2026-09-07', fin: '2026-09-16', dias: LUN_MIE, noHayClase: festivo, hasta: '2026-09-16' }))
    .toEqual(['2026-09-07', '2026-09-09', '2026-09-16'])
})

test('el tope de seguridad limita el nº de clases', () => {
  expect(calcularFechasCurso({ inicio: '2026-01-05', fin: '2026-12-31', dias: LUN_MIE, noHayClase: sinFestivos, max: 3 }))
    .toEqual(['2026-01-05', '2026-01-07', '2026-01-12'])
})

test('sin inicio o fin no hay clases', () => {
  expect(calcularFechasCurso({ inicio: '', fin: '2026-09-16', dias: LUN_MIE, noHayClase: sinFestivos })).toEqual([])
  expect(calcularFechasCurso({ inicio: '2026-09-07', fin: '', dias: LUN_MIE, noHayClase: sinFestivos })).toEqual([])
})

test('ampliar agrega sólo lo que va después de la última clase existente', () => {
  expect(fechasAmpliacion(['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'], '2026-09-09'))
    .toEqual(['2026-09-14', '2026-09-16'])
  expect(fechasAmpliacion(['2026-09-07'], null)).toEqual(['2026-09-07'])
})

test('ampliar da el mismo calendario que regenerar el curso con el nuevo final', () => {
  // Un curso de un año con feriados reales de Chile repartidos y una semana
  // declarada sin clase: el caso en que las clases corridas se mezclan con las nuevas.
  const festivos = new Set([
    '2026-09-14', '2026-09-16', '2026-09-18', '2026-10-12', '2026-10-19', '2026-11-02',
    '2026-12-08', '2026-12-25', '2027-01-01', '2027-04-02', '2027-05-21',
  ])
  const noHayClase = (d: string) => festivos.has(d)
  const inicio = '2026-08-17'
  for (const [finViejo, finNuevo] of [['2027-06-17', '2027-08-17'], ['2026-12-15', '2027-01-20'], ['2026-09-30', '2026-10-21']]) {
    const actual = calcularFechasCurso({ inicio, fin: finViejo, dias: LUN_MIE, noHayClase })
    const nuevas = fechasAmpliacion(
      calcularFechasCurso({ inicio, fin: finNuevo, dias: LUN_MIE, noHayClase }),
      actual[actual.length - 1],
    )
    const regenerado = calcularFechasCurso({ inicio, fin: finNuevo, dias: LUN_MIE, noHayClase })
    expect([...actual, ...nuevas]).toEqual(regenerado)
  }
})

test('addDaysISO cruza mes y año sin desfase de zona horaria', () => {
  expect(addDaysISO('2026-09-30', 1)).toBe('2026-10-01')
  expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
})
