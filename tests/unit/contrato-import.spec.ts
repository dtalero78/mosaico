import { test, expect } from '@playwright/test'
import { normalizeContractNumber } from '../../src/lib/contrato-import'

/**
 * El N.º de contrato es la llave que enlaza PEOPLE, ACADEMICA, USUARIOS_ROLES y
 * FINANCIEROS. Estos casos son los que trajeron los PDF reales de enero de 2026 y
 * las formas sucias que hubo que normalizar a mano en septiembre.
 */

test('quita el rótulo que la IA devuelve pegado al número', () => {
  expect(normalizeContractNumber('Contrato Online N.º 5-2330-26')).toBe('01-M5-2330-26')
  expect(normalizeContractNumber('Contrato N.º 5-2545-26')).toBe('01-M5-2545-26')
  expect(normalizeContractNumber('N.º01-M5-2345-26')).toBe('01-M5-2345-26')
  expect(normalizeContractNumber('Nº 5-2264-26')).toBe('01-M5-2264-26')
})

test('tolera el cero del país y los espacios entre guiones', () => {
  expect(normalizeContractNumber('05-2271-26')).toBe('01-M5-2271-26')
  expect(normalizeContractNumber('5 - 2321 - 26')).toBe('01-M5-2321-26')
})

test('conserva los dígitos del consecutivo: no rellena a cinco', () => {
  expect(normalizeContractNumber('5-2338-26')).toBe('01-M5-2338-26')
  expect(normalizeContractNumber('6-124-26')).toBe('01-I6-124-26')
  expect(normalizeContractNumber('5-09173-26')).toBe('01-M5-09173-26')
})

test('IMPULSA: por el segmento 6 o por la bandera', () => {
  expect(normalizeContractNumber('6-125-26')).toBe('01-I6-125-26')
  expect(normalizeContractNumber('5-2100-26', true)).toBe('01-I6-2100-26')
})

test('año en cuatro cifras y sufijo de desdoble', () => {
  expect(normalizeContractNumber('5-2330-2026')).toBe('01-M5-2330-26')
  expect(normalizeContractNumber('5-2477-26A')).toBe('01-M5-2477A-26')
})

test('un número ya canónico pasa igual (en mayúsculas)', () => {
  expect(normalizeContractNumber('01-m5-2338-26')).toBe('01-M5-2338-26')
  expect(normalizeContractNumber('01-M5-2477A-26')).toBe('01-M5-2477A-26')
  expect(normalizeContractNumber('01-I6-124-26')).toBe('01-I6-124-26')
})

test('lo que no se reconoce vuelve tal cual para que lo edite el usuario', () => {
  expect(normalizeContractNumber('5285326')).toBe('5285326')
  expect(normalizeContractNumber('')).toBe('')
  expect(normalizeContractNumber(null)).toBe('')
})
