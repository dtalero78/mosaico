import { test, expect } from '@playwright/test'
import { esDeEstaNivelacion, elegirAgendamientoActual } from '../../src/lib/nivelacion-agendamiento'

/**
 * Regla: sólo cuenta el agendamiento creado DESPUÉS de la solicitud actual. Los
 * casos son los reales del 24-sep-2026: alumnos con una nivelación ya cerrada
 * que pedían la segunda y caían directo en Pendientes con la fecha vieja.
 */

// ANGELINA MATUS: 1ª nivelación agendada el 25-ago (dictada el 28-ago, cerrada);
// 2ª solicitud el 24-sep 00:04Z; agrupada el 24-sep 14:15Z.
const SOLICITUD = '2026-09-24T00:04:44.000Z'
const VIEJO = { bookingId: 'viejo', creadoEn: '2026-08-25T12:00:00.000Z', cancelo: false }
const NUEVO = { bookingId: 'nuevo', creadoEn: '2026-09-24T14:15:03.000Z', cancelo: false }

test('el agendamiento de la nivelación anterior NO cuenta para la solicitud nueva', () => {
  expect(esDeEstaNivelacion(SOLICITUD, VIEJO.creadoEn)).toBe(false)
  // Recién aprobada, sin agrupar todavía → nada → sigue en Agrupaciones
  expect(elegirAgendamientoActual(SOLICITUD, [VIEJO])).toBeNull()
})

test('agrupada la nueva, se toma la nueva y no la vieja', () => {
  expect(elegirAgendamientoActual(SOLICITUD, [VIEJO, NUEVO])?.bookingId).toBe('nuevo')
  // El orden en que lleguen las filas no importa
  expect(elegirAgendamientoActual(SOLICITUD, [NUEVO, VIEJO])?.bookingId).toBe('nuevo')
})

test('con dos agendamientos posteriores manda el creado más recientemente', () => {
  const primero = { bookingId: 'a', creadoEn: '2026-09-24T14:15:00.000Z', cancelo: false }
  const segundo = { bookingId: 'b', creadoEn: '2026-09-24T16:40:00.000Z', cancelo: false }
  expect(elegirAgendamientoActual(SOLICITUD, [segundo, primero])?.bookingId).toBe('b')
})

test('un agendamiento creado segundos después de la solicitud sí cuenta', () => {
  expect(esDeEstaNivelacion(SOLICITUD, '2026-09-24T00:04:44.000Z')).toBe(true)
  expect(esDeEstaNivelacion(SOLICITUD, '2026-09-24T00:04:45.000Z')).toBe(true)
})

test('el agendamiento cancelado nunca cuenta, aunque sea posterior', () => {
  const cancelado = { ...NUEVO, cancelo: true }
  expect(elegirAgendamientoActual(SOLICITUD, [VIEJO, cancelado])).toBeNull()
})

test('sin fecha de solicitud se conserva la regla anterior: cualquier vivo cuenta', () => {
  expect(esDeEstaNivelacion(null, VIEJO.creadoEn)).toBe(true)
  expect(esDeEstaNivelacion('no-es-fecha', VIEJO.creadoEn)).toBe(true)
  expect(elegirAgendamientoActual(undefined, [VIEJO])?.bookingId).toBe('viejo')
})

test('acepta Date y string por igual', () => {
  expect(esDeEstaNivelacion(new Date(SOLICITUD), new Date(NUEVO.creadoEn))).toBe(true)
  expect(esDeEstaNivelacion(new Date(SOLICITUD), new Date(VIEJO.creadoEn))).toBe(false)
})
