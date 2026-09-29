import { test, expect } from '@playwright/test'
import {
  HORAS_EN_GESTION,
  entraEnGestion,
  msRestantesEnGestion,
  saleDeEnGestion,
  textoRestante,
} from '../../src/lib/contrato-en-gestion'

/**
 * La lista "En Gestión" es el camino de vuelta al contrato recién creado
 * mientras se consigue la firma. Estas pruebas fijan quién entra y, sobre todo,
 * los bordes del plazo: el contrato sale a las 5 horas de haberse CREADO, ni un
 * minuto antes — y en cuanto se firma, que es cuando pasa a "Firmados sin
 * aprobar".
 */

const CREADO = '2026-09-26T21:49:37.214Z'
const despues = (h: number, min = 0) => new Date(new Date(CREADO).getTime() + h * 3600_000 + min * 60_000)

test('el plazo es de 5 horas', () => {
  expect(HORAS_EN_GESTION).toBe(5)
  expect(saleDeEnGestion(CREADO)?.toISOString()).toBe('2026-09-27T02:49:37.214Z')
})

test('recién creado, sin firmar, sin listo ni aprobar: entra', () => {
  expect(entraEnGestion({ creado: CREADO }, despues(0, 1))).toBe(true)
  expect(entraEnGestion({ creado: CREADO, firmado: false, gestionListo: false, aprobacion: null }, despues(3))).toBe(true)
})

test('a las 4 h 59 min sigue en la lista; a las 5 h exactas ya salió', () => {
  expect(entraEnGestion({ creado: CREADO }, despues(4, 59))).toBe(true)
  expect(entraEnGestion({ creado: CREADO }, despues(5))).toBe(false)
  expect(entraEnGestion({ creado: CREADO }, despues(30))).toBe(false)
})

test('firmado sale, aunque esté dentro del plazo: pasa a «Firmados sin aprobar»', () => {
  expect(entraEnGestion({ creado: CREADO, firmado: true }, despues(0, 5))).toBe(false)
  expect(entraEnGestion({ creado: CREADO, firmado: true, gestionListo: false, aprobacion: null }, despues(1))).toBe(false)
})

test('marcado listo sale, aunque esté dentro del plazo', () => {
  expect(entraEnGestion({ creado: CREADO, gestionListo: true }, despues(1))).toBe(false)
})

test('aprobado sale, aunque esté dentro del plazo', () => {
  expect(entraEnGestion({ creado: CREADO, aprobacion: 'Aprobado' }, despues(1))).toBe(false)
  expect(entraEnGestion({ creado: CREADO, aprobacion: ' Aprobado ' }, despues(1))).toBe(false)
})

test('los demás estados NO lo sacan: sólo firmado, listo y aprobado', () => {
  // Pendiente o Devuelto siguen siendo contratos a los que hay que poder volver.
  expect(entraEnGestion({ creado: CREADO, aprobacion: 'Pendiente' }, despues(1))).toBe(true)
  expect(entraEnGestion({ creado: CREADO, aprobacion: 'Devuelto' }, despues(1))).toBe(true)
})

test('quitado a mano: sale, y sólo vuelve con «Ver los quitados»', () => {
  const fila = { creado: CREADO, quitadoEn: despues(1).toISOString() }
  expect(entraEnGestion(fila, despues(2))).toBe(false)
  expect(entraEnGestion(fila, despues(2), true)).toBe(true)
})

test('«Ver los quitados» no levanta el plazo ni las otras condiciones', () => {
  const quitado = despues(1).toISOString()
  expect(entraEnGestion({ creado: CREADO, quitadoEn: quitado }, despues(6), true)).toBe(false)
  expect(entraEnGestion({ creado: CREADO, quitadoEn: quitado, firmado: true }, despues(2), true)).toBe(false)
  expect(entraEnGestion({ creado: CREADO, quitadoEn: quitado, gestionListo: true }, despues(2), true)).toBe(false)
  expect(entraEnGestion({ creado: CREADO, quitadoEn: quitado, aprobacion: 'Aprobado' }, despues(2), true)).toBe(false)
})

test('sin fecha de creación no entra: no se puede afirmar que esté en plazo', () => {
  expect(entraEnGestion({ creado: null }, despues(0))).toBe(false)
  expect(entraEnGestion({ creado: 'no es una fecha' }, despues(0))).toBe(false)
  expect(msRestantesEnGestion(undefined)).toBe(0)
})

test('el tiempo que le queda se lee en horas y minutos', () => {
  expect(textoRestante(msRestantesEnGestion(CREADO, despues(0)))).toBe('5 h')
  expect(textoRestante(msRestantesEnGestion(CREADO, despues(0, 40)))).toBe('4 h 20 min')
  expect(textoRestante(msRestantesEnGestion(CREADO, despues(4, 15)))).toBe('45 min')
  expect(textoRestante(30_000)).toBe('menos de 1 min')
  expect(textoRestante(0)).toBe('plazo cumplido')
  expect(textoRestante(-5000)).toBe('plazo cumplido')
})
