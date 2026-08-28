import { test, expect } from '@playwright/test'
import {
  corteConfirmacion, corteCancelacion, estadoConfirmacion,
  puedeConfirmarAlumno, debeCancelarse,
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

test('el alumno puede confirmar hasta las 09:00 del jueves, no despues', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z' }
  // Miércoles: abierta
  expect(puedeConfirmarAlumno(det, new Date('2026-08-26T18:00:00.000Z'))).toBe(true)
  // Jueves 08:59 Chile (12:59Z): abierta
  expect(puedeConfirmarAlumno(det, new Date('2026-08-27T12:59:00.000Z'))).toBe(true)
  // Jueves 09:00 exactas: cerrada
  expect(puedeConfirmarAlumno(det, new Date('2026-08-27T13:00:00.000Z'))).toBe(false)
})

test('una vez confirmada no vuelve a estar abierta ni se cancela', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z', confirmadoEn: '2026-08-26T12:00:00.000Z' }
  expect(estadoConfirmacion(det, new Date('2026-08-26T18:00:00.000Z'))).toBe('confirmada')
  // Aun pasado el jueves 22:00 sigue confirmada y NO se cancela
  expect(estadoConfirmacion(det, new Date('2026-08-28T18:00:00.000Z'))).toBe('confirmada')
  expect(debeCancelarse(det, new Date('2026-08-28T18:00:00.000Z'))).toBe(false)
})

test('sin confirmar: vencida a las 09:00, cancelable recien a las 22:00', () => {
  const det = { fecha: '2026-08-25T18:00:00.000Z' }
  const jueves0900 = new Date('2026-08-27T13:00:00.000Z')
  const jueves2159 = new Date('2026-08-28T01:59:00.000Z') // 21:59 Chile
  const jueves2200 = new Date('2026-08-28T02:00:00.000Z') // 22:00 Chile
  expect(estadoConfirmacion(det, jueves0900)).toBe('vencida')
  // Entre 09:00 y 22:00 esta vencida para el alumno pero AUN NO se cancela:
  // es la ventana en que Servicio la puede confirmar a mano.
  expect(debeCancelarse(det, jueves0900)).toBe(false)
  expect(debeCancelarse(det, jueves2159)).toBe(false)
  expect(debeCancelarse(det, jueves2200)).toBe(true)
})

test('sin solicitud no hay nada que confirmar ni cancelar', () => {
  expect(estadoConfirmacion(null)).toBe('sin-solicitud')
  expect(estadoConfirmacion({})).toBe('sin-solicitud')
  expect(puedeConfirmarAlumno(null)).toBe(false)
  expect(debeCancelarse(null)).toBe(false)
})

test('el corte no depende del huso del proceso', () => {
  // Mismo instante expresado desde husos distintos: mismo corte.
  const a = corteConfirmacion('2026-08-27T12:00:00.000Z')          // jueves 08:00 Chile
  const b = corteConfirmacion(new Date('2026-08-27T12:00:00Z'))
  expect(a).toBe(b)
  expect(a).toBe('2026-08-27T09:00')
})
