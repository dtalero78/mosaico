import { test, expect } from '@playwright/test'
import { vigenciaValida, mensajeVigenciaInvalida } from '../../src/lib/vigencia-modulo'

/**
 * Vigencia de Crear Contrato: un contrato Módulo dura 3 meses fijos; uno que no
 * es módulo admite de 3 a 9. La misma regla la aplican el wizard y el endpoint.
 */

test('Módulo: sólo 3 meses', () => {
  expect(vigenciaValida('3', true)).toBe(true)
  expect(vigenciaValida(3, true)).toBe(true)
  for (const v of ['2', '4', '9', '12', '', null, undefined]) {
    expect(vigenciaValida(v, true)).toBe(false)
  }
})

test('No módulo: de 3 a 9 meses, bordes incluidos', () => {
  for (let n = 3; n <= 9; n++) expect(vigenciaValida(String(n), false)).toBe(true)
  for (const v of ['0', '1', '2', '10', '12', '', 'abc', '3.5', '-4', null]) {
    expect(vigenciaValida(v, false)).toBe(false)
  }
})

test('El mensaje dice la regla que aplica', () => {
  expect(mensajeVigenciaInvalida(true)).toContain('3 meses')
  expect(mensajeVigenciaInvalida(false)).toContain('entre 3 y 9')
})
