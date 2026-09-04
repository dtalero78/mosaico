import { test, expect } from '@playwright/test'
import {
  corteConfirmacion, corteCancelacion, estadoConfirmacion,
  puedeConfirmarAlumno, debeCancelarse,
  HORAS_NIVELACION, esHoraNivelacionValida,
} from '../../src/lib/nivelacion-confirmacion'

/**
 * El ciclo se ancla al jueves: 09:00 cierra para el alumno, 22:00 cancela.
 * Los instantes se escriben en UTC y se comprueba el resultado EN CHILE, que es
 * donde vive la regla. En agosto Chile va en UTC-4.
 */

test('el corte cae en el jueves siguiente a la solicitud', () => {
  // Lunes 25-ago-2026 14:00 Chile (18:00Z) → jueves 27
  expect(corteConfirmacion('2026-08-25T18:00:00.000Z')).toBe('2026-08-27T09:00')
  // Martes → mismo jueves
  expect(corteConfirmacion('2026-08-26T18:00:00.000Z')).toBe('2026-08-27T09:00')
  // Miércoles noche → mismo jueves (12 h para confirmar)
  expect(corteConfirmacion('2026-08-27T01:00:00.000Z')).toBe('2026-08-27T09:00')
})

test('un jueves antes de las 09:00 cierra ESE mismo jueves', () => {
  // Jueves 27-ago 08:00 Chile = 12:00Z
  expect(corteConfirmacion('2026-08-27T12:00:00.000Z')).toBe('2026-08-27T09:00')
})

test('un jueves pasadas las 09:00 pasa al jueves siguiente', () => {
  // Jueves 27-ago 09:00 exactas → el ciclo ya cerró, va al 3-sep
  expect(corteConfirmacion('2026-08-27T13:00:00.000Z')).toBe('2026-09-03T09:00')
  // Jueves 27-ago 20:00 Chile (00:00Z del 28) → 3-sep
  expect(corteConfirmacion('2026-08-28T00:00:00.000Z')).toBe('2026-09-03T09:00')
})

test('viernes y fin de semana van al jueves siguiente', () => {
  // Viernes 28-ago 15:00 Chile → 3-sep (casi 7 días)
  expect(corteConfirmacion('2026-08-28T19:00:00.000Z')).toBe('2026-09-03T09:00')
  // Domingo 30-ago → 3-sep
  expect(corteConfirmacion('2026-08-30T19:00:00.000Z')).toBe('2026-09-03T09:00')
})

test('el corte cruza mes y año sin romperse', () => {
  // Lunes 28-dic-2026 → jueves 31-dic
  expect(corteConfirmacion('2026-12-28T18:00:00.000Z')).toBe('2026-12-31T09:00')
  // Jueves 31-dic 20:00 Chile → jueves 7-ene-2027
  expect(corteConfirmacion('2027-01-01T00:00:00.000Z')).toBe('2027-01-07T09:00')
})

test('la cancelacion es el MISMO jueves a las 22:00', () => {
  expect(corteCancelacion('2026-08-25T18:00:00.000Z')).toBe('2026-08-27T22:00')
  expect(corteCancelacion('2026-08-28T19:00:00.000Z')).toBe('2026-09-03T22:00')
})

test('el plazo se cuenta desde el evento: 3 horas antes', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z' }
  const evento = new Date('2026-08-28T21:00:00.000Z')  // nivelación

  // Un día antes: abierta, aunque el jueves de la solicitud ya pasó.
  // Es el caso que motivó el cambio: el alumno veía "venció" con el evento
  // todavía a 20 horas de distancia.
  expect(puedeConfirmarAlumno(det, new Date('2026-08-27T21:00:00.000Z'), evento)).toBe(true)
  // A 3 h 01 min: todavía alcanza
  expect(puedeConfirmarAlumno(det, new Date('2026-08-28T17:59:00.000Z'), evento)).toBe(true)
  // A 3 h exactas: ya no
  expect(puedeConfirmarAlumno(det, new Date('2026-08-28T18:00:00.000Z'), evento)).toBe(false)
  // Con el evento ya pasado: tampoco
  expect(puedeConfirmarAlumno(det, new Date('2026-08-28T22:00:00.000Z'), evento)).toBe(false)
})

test('sin horario asignado el plazo no corre: queda abierta', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z' }
  // El alumno no tiene qué confirmar todavía (el panel le oculta el botón),
  // pero decir "venció" sería falso: no ha tenido oportunidad.
  expect(puedeConfirmarAlumno(det, new Date('2026-09-30T18:00:00.000Z'))).toBe(true)
  expect(estadoConfirmacion(det, new Date('2026-09-30T18:00:00.000Z'))).toBe('abierta')
})

test('una vez confirmada no vuelve a estar abierta ni se cancela', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z', confirmadoEn: '2026-08-26T12:00:00.000Z' }
  expect(estadoConfirmacion(det, new Date('2026-08-26T18:00:00.000Z'))).toBe('confirmada')
  // Aun pasado el jueves 22:00 sigue confirmada y NO se cancela
  expect(estadoConfirmacion(det, new Date('2026-08-28T18:00:00.000Z'))).toBe('confirmada')
  expect(debeCancelarse(det, new Date('2026-08-28T18:00:00.000Z'))).toBe(false)
})

test('la cancelación automática sigue en el jueves 22:00', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z' }
  const jueves0900 = new Date('2026-08-27T13:00:00.000Z')
  const jueves2159 = new Date('2026-08-28T01:59:00.000Z') // 21:59 Chile
  const jueves2200 = new Date('2026-08-28T02:00:00.000Z') // 22:00 Chile
  // El plazo del ALUMNO ya no depende del jueves — sin evento sigue abierta.
  expect(estadoConfirmacion(det, jueves0900)).toBe('abierta')
  // La cancelación del cron NO cambió: sigue corriendo el jueves 22:00 sobre
  // las nivelaciones sin confirmar que todavía no tienen evento agendado.
  expect(debeCancelarse(det, jueves0900)).toBe(false)
  expect(debeCancelarse(det, jueves2159)).toBe(false)
  expect(debeCancelarse(det, jueves2200)).toBe(true)
})

test('sin solicitud no hay nada que confirmar ni cancelar', () => {
  expect(estadoConfirmacion(null)).toBe('sin-solicitud')
  expect(estadoConfirmacion({})).toBe('sin-solicitud')
  expect(puedeConfirmarAlumno(null)).toBe(false)
  expect(puedeConfirmarAlumno({}, new Date(), '2026-08-28T21:00:00.000Z')).toBe(false)
  expect(debeCancelarse(null)).toBe(false)
})

test('el corte no depende del huso del proceso', () => {
  // Mismo instante expresado desde husos distintos: mismo corte.
  const a = corteConfirmacion('2026-08-27T12:00:00.000Z')          // jueves 08:00 Chile
  const b = corteConfirmacion(new Date('2026-08-27T12:00:00Z'))
  expect(a).toBe(b)
  expect(a).toBe('2026-08-27T09:00')
})

test('las horas de nivelacion van de 17:00 a 20:30 cada media hora', () => {
  expect(HORAS_NIVELACION).toEqual([
    '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  ])
})

test('solo se admiten horas del catalogo', () => {
  expect(esHoraNivelacionValida('17:00')).toBe(true)
  expect(esHoraNivelacionValida('20:30')).toBe(true)
  // Fuera de rango o fuera de la media hora: no se admiten.
  expect(esHoraNivelacionValida('16:30')).toBe(false)
  expect(esHoraNivelacionValida('21:00')).toBe(false)
  expect(esHoraNivelacionValida('18:15')).toBe(false)
  expect(esHoraNivelacionValida('5 pm')).toBe(false)
  expect(esHoraNivelacionValida('')).toBe(false)
  expect(esHoraNivelacionValida(null)).toBe(false)
})
