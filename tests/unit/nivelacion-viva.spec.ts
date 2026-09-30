import { test, expect } from '@playwright/test'
import {
  etapaNivelacion, armarNivelacionViva, mensajeNivelacionSinResolver,
  ETAPA_NIVELACION_META, TIPO_NIVELACION_SIN_RESOLVER,
} from '../../src/lib/nivelacion-viva'

/**
 * Un usuario tiene como mucho UNA nivelación viva, y mientras exista el guía no
 * puede pedir otra. El detalle es el de una solicitud real del 24-sep-2026
 * (KODOMO, devuelta a Solicitudes el 29-sep).
 */
const DETALLE = {
  leccion: 'Leccion 08',
  modulo: 'Modulo 01',
  hora: '19:00',
  duracionMin: 30,
  motivo: 'Refuerzo de restas',
  fecha: '2026-09-24T21:10:00.000Z',
  marcadoPor: 'guia@mosaico.cl',
}

test('sin ninguna marca no hay nivelación viva', () => {
  expect(etapaNivelacion({})).toBeNull()
  expect(etapaNivelacion({ nivelacion: false, aprobadoNivelacion: false })).toBeNull()
  expect(etapaNivelacion({ nivelacion: null, aprobadoNivelacion: null, tieneEvento: true })).toBeNull()
  expect(armarNivelacionViva({ nivelacion: false, aprobadoNivelacion: false, detalle: DETALLE })).toBeNull()
})

test('las tres etapas salen de las marcas y de si ya tiene evento', () => {
  expect(etapaNivelacion({ nivelacion: true })).toBe('SOLICITUDES')
  expect(etapaNivelacion({ aprobadoNivelacion: true })).toBe('AGRUPACIONES')
  expect(etapaNivelacion({ aprobadoNivelacion: true, tieneEvento: false })).toBe('AGRUPACIONES')
  expect(etapaNivelacion({ aprobadoNivelacion: true, tieneEvento: true })).toBe('PENDIENTES')
})

test('pedida y sin aprobar sigue en Solicitudes aunque conserve un agendamiento', () => {
  // La devuelta desde Agrupaciones, o la que arrastra el agendamiento de una
  // nivelación anterior: el evento no la saca de Solicitudes.
  expect(etapaNivelacion({ nivelacion: true, aprobadoNivelacion: false, tieneEvento: true })).toBe('SOLICITUDES')
})

test('con las dos marcas manda la aprobación', () => {
  // El estado que dejaba volver a marcar la casilla sobre una aprobada.
  expect(etapaNivelacion({ nivelacion: true, aprobadoNivelacion: true })).toBe('AGRUPACIONES')
  expect(etapaNivelacion({ nivelacion: true, aprobadoNivelacion: true, tieneEvento: true })).toBe('PENDIENTES')
})

test('arma la nivelación viva con lo que se pidió', () => {
  const v = armarNivelacionViva({ nivelacion: true, detalle: DETALLE, nombre: '  Josefa Villarroel ' })
  expect(v).toEqual({
    etapa: 'SOLICITUDES',
    nombre: 'Josefa Villarroel',
    modulo: 'Modulo 01',
    leccion: 'Leccion 08',
    hora: '19:00',
    duracionMin: 30,
    motivo: 'Refuerzo de restas',
    fechaSolicitud: '2026-09-24T21:10:00.000Z',
    fechaEvento: null,
  })
})

test('la fecha del evento sólo viaja cuando está en Pendientes', () => {
  const evento = '2026-10-02T22:00:00.000Z'
  const pen = armarNivelacionViva({ aprobadoNivelacion: true, detalle: DETALLE, tieneEvento: true, fechaEvento: evento })
  expect(pen?.etapa).toBe('PENDIENTES')
  expect(pen?.fechaEvento).toBe(evento)
  const agr = armarNivelacionViva({ aprobadoNivelacion: true, detalle: DETALLE, tieneEvento: false, fechaEvento: evento })
  expect(agr?.etapa).toBe('AGRUPACIONES')
  expect(agr?.fechaEvento).toBeNull()
})

test('tolera un detalle vacío, en texto o sin duración', () => {
  // Las solicitudes anteriores al 25-sep no guardaron la duración sugerida.
  const { duracionMin, ...sinDuracion } = DETALLE
  expect(duracionMin).toBe(30)
  expect(armarNivelacionViva({ nivelacion: true, detalle: sinDuracion })?.duracionMin).toBeNull()
  expect(armarNivelacionViva({ nivelacion: true, detalle: JSON.stringify(DETALLE) })?.leccion).toBe('Leccion 08')
  const vacia = armarNivelacionViva({ aprobadoNivelacion: true, detalle: null })
  expect(vacia).toMatchObject({ etapa: 'AGRUPACIONES', leccion: null, fechaSolicitud: null, nombre: null })
  expect(armarNivelacionViva({ nivelacion: true, detalle: 'no es json' })?.leccion).toBeNull()
})

test('el rechazo nombra al usuario y dice en qué está', () => {
  expect(mensajeNivelacionSinResolver({ etapa: 'SOLICITUDES', nombre: 'Josefa Villarroel' }))
    .toBe('No se puede solicitar otra nivelación: Josefa Villarroel tiene una sin resolver (solicitada, esperando aprobación).')
  expect(mensajeNivelacionSinResolver({ etapa: 'AGRUPACIONES', nombre: 'Josefa Villarroel' })).toContain('aprobada, esperando horario')
  expect(mensajeNivelacionSinResolver({ etapa: 'PENDIENTES', nombre: 'Josefa Villarroel' })).toContain('agendada')
  expect(mensajeNivelacionSinResolver({ etapa: 'PENDIENTES', nombre: null })).toMatch(/^No se puede solicitar otra nivelación: El usuario /)
})

test('cada etapa tiene su pestaña y el tipo del rechazo no cambia', () => {
  expect(ETAPA_NIVELACION_META.SOLICITUDES.pestana).toBe('Solicitudes')
  expect(ETAPA_NIVELACION_META.AGRUPACIONES.pestana).toBe('Agrupaciones')
  expect(ETAPA_NIVELACION_META.PENDIENTES.pestana).toBe('Pendientes')
  // El panel del guía abre el modal comparando contra este valor.
  expect(TIPO_NIVELACION_SIN_RESOLVER).toBe('nivelacion_sin_resolver')
})
