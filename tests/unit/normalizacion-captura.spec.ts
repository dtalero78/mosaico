import { test, expect } from '@playwright/test'
import { normalizeNumeroId } from '../../src/lib/numeroid-normalize'
import { normalizeTelefono, normalizeTelefonoOrNull } from '../../src/lib/telefono-normalize'

/**
 * Lo que se teclea en un formulario y lo que se busca en la base tienen que
 * pasar por la MISMA normalización. Si el alta guarda "8.986.549-2" y el
 * buscador compara contra "89865492", la persona queda partida en dos.
 */

test('el documento pierde puntos, guiones y espacios', () => {
  expect(normalizeNumeroId('8.986.549-2')).toBe('89865492')
  expect(normalizeNumeroId('26.008.510-7')).toBe('260085107')
  expect(normalizeNumeroId(' 151576443')).toBe('151576443')
  expect(normalizeNumeroId('  17.878.258-4 ')).toBe('178782584')
})

test('la K final del RUT chileno se CONSERVA y sube a mayúscula', () => {
  // Es el caso que rompían los filtros que hacían replace(/[^A-Z0-9]/g) ANTES
  // de toUpperCase: la k minúscula caía en la clase negada y se borraba.
  expect(normalizeNumeroId('26.824.008-k')).toBe('26824008K')
  expect(normalizeNumeroId('15.534.394-K')).toBe('15534394K')
  expect(normalizeNumeroId('18201897k')).toBe('18201897K')
})

test('un documento ya canónico no se altera', () => {
  expect(normalizeNumeroId('89865492')).toBe('89865492')
  expect(normalizeNumeroId('154347275')).toBe('154347275')
})

test('el teléfono queda en puros dígitos: sin +, sin espacios', () => {
  expect(normalizeTelefono('+56 9 7981 9760')).toBe('56979819760')
  expect(normalizeTelefono('+57 300 123 4567')).toBe('573001234567')
  expect(normalizeTelefono('(300) 123-4567')).toBe('3001234567')
  expect(normalizeTelefono('  56981281112  ')).toBe('56981281112')
})

test('el prefijo de país se concatena ANTES de normalizar', () => {
  // Así es como lo arman los formularios: select de prefijo + número.
  expect(normalizeTelefono('+57' + '3001234567')).toBe('573001234567')
})

test('vacío y nulo no inventan valor', () => {
  expect(normalizeNumeroId('')).toBe('')
  expect(normalizeNumeroId(null)).toBe('')
  expect(normalizeTelefono(undefined)).toBe('')
  expect(normalizeTelefono('+ ')).toBe('')
  expect(normalizeTelefonoOrNull('')).toBe(null)
  expect(normalizeTelefonoOrNull('+56 9')).toBe('569')
})
