import { test, expect } from '@playwright/test'
import {
  parseTipoSalida,
  ofreceReactivar,
  fueInactivadoPorAdmin,
  TIPOS_SALIDA_CUPO,
} from '../../src/lib/tipo-salida-cupo'

/**
 * Inactivar a un alumno SUELTA su asiento: se le borra el curso y se le sueltan
 * las clases futuras. Eso no se deshace solo, así que quien inactiva tiene que
 * declarar cómo sale. Estas pruebas fijan las dos decisiones que se derivan de
 * esa declaración: si el servidor la acepta, y si la ficha le ofrece volver.
 */

test('sólo hay dos formas de salir del salón', () => {
  expect([...TIPOS_SALIDA_CUPO]).toEqual(['REEMPLAZO', 'TEMPORAL'])
})

test('el servidor acepta los dos tipos, escritos como sea', () => {
  expect(parseTipoSalida('REEMPLAZO')).toBe('REEMPLAZO')
  expect(parseTipoSalida('temporal')).toBe('TEMPORAL')
  expect(parseTipoSalida('  Reemplazo  ')).toBe('REEMPLAZO')
})

test('sin tipo de salida no se inactiva: el vacío NO es una decisión', () => {
  // Es lo que devuelve el formulario cuando nadie eligió. Si esto pasara por
  // válido, el alumno quedaría fuera del salón sin que nadie hubiera decidido
  // si puede volver.
  expect(parseTipoSalida('')).toBeNull()
  expect(parseTipoSalida(null)).toBeNull()
  expect(parseTipoSalida(undefined)).toBeNull()
  expect(parseTipoSalida('DEFINITIVO')).toBeNull()
})

test('REEMPLAZO cierra la puerta: su cupo es de otro', () => {
  expect(ofreceReactivar({ tipoSalida: 'REEMPLAZO' })).toBe(false)
})

test('TEMPORAL la deja abierta', () => {
  expect(ofreceReactivar({ tipoSalida: 'TEMPORAL' })).toBe(true)
})

test('el inactivado ANTES de esta regla conserva «Activar»', () => {
  // Los que ya estaban inactivos cuando se estrenó el tipo de salida no lo
  // tienen. Quitarles el botón los dejaría sin ningún camino de vuelta desde
  // la ficha, que es peor que ofrecérselo de más.
  expect(ofreceReactivar({})).toBe(true)
  expect(ofreceReactivar(null)).toBe(true)
  expect(ofreceReactivar(undefined)).toBe(true)
  expect(ofreceReactivar({ tipoSalida: '' })).toBe(true)
})

test('«lo sacó un admin» se lee de la acción, NO de estadoInactivo', () => {
  // Todo beneficiario pendiente de aprobación nace inactivo: mirar esa columna
  // a secas marcaría como suspendida a media base.
  expect(fueInactivadoPorAdmin({ accion: 'INACTIVACION' })).toBe(true)
  expect(fueInactivadoPorAdmin({ accion: 'REACTIVACION' })).toBe(false)
  expect(fueInactivadoPorAdmin(null)).toBe(false)
  expect(fueInactivadoPorAdmin({})).toBe(false)
})
