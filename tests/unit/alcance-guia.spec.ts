import { test, expect } from '@playwright/test'
import { resolverAlcancePorGuia, alcanceSinResultados } from '../../src/lib/alcance-guia'

/**
 * Procesos sin gestión: el rol GUIA ve sólo lo suyo. Lo que se fija aquí es que
 * el guía NO pueda pedir lo de otro, y que un guía sin ficha no vea lo de todos.
 */
const ANA = 'adv_1755000000001_ana'
const LEANDRO = 'adv_1755000000002_lea'

test('el guía ve lo suyo aunque no pida ningún guía', () => {
  expect(resolverAlcancePorGuia({ esGuia: true, guiaDeSesion: ANA })).toEqual({ soloPropios: true, guiaId: ANA })
})

test('el guía no puede pedir lo de otro: el filtro que mande se ignora', () => {
  const a = resolverAlcancePorGuia({ esGuia: true, guiaDeSesion: ANA, guiaPedido: LEANDRO })
  expect(a).toEqual({ soloPropios: true, guiaId: ANA })
})

test('un guía sin ficha en GUIAS no ve nada (nunca lo de todos)', () => {
  for (const sinFicha of [null, undefined, '', '   ']) {
    const a = resolverAlcancePorGuia({ esGuia: true, guiaDeSesion: sinFicha, guiaPedido: LEANDRO })
    expect(a).toEqual({ soloPropios: true, guiaId: null })
    expect(alcanceSinResultados(a)).toBe(true)
  }
})

test('los demás roles ven todo y pueden filtrar por el guía que elijan', () => {
  const todos = resolverAlcancePorGuia({ esGuia: false })
  expect(todos).toEqual({ soloPropios: false, guiaId: null })
  expect(alcanceSinResultados(todos)).toBe(false)

  const filtrado = resolverAlcancePorGuia({ esGuia: false, guiaPedido: ` ${LEANDRO} ` })
  expect(filtrado).toEqual({ soloPropios: false, guiaId: LEANDRO })
  expect(alcanceSinResultados(filtrado)).toBe(false)
})

test('a quien no es guía no se le aplica la ficha de la sesión', () => {
  // Un coordinador que además dicta clases tiene ficha en GUIAS, pero ve todo.
  expect(resolverAlcancePorGuia({ esGuia: false, guiaDeSesion: ANA })).toEqual({ soloPropios: false, guiaId: null })
})
