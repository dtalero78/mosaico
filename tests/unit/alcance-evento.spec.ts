import { test, expect } from '@playwright/test'
import { eventoEnAlcance, motivoFueraDeAlcance } from '../../src/lib/alcance-evento'

/**
 * ¿Un taller/olimpiada del calendario es para este alumno? Misma regla que la
 * consulta de la lista; la aplica el servidor al agendar.
 */
const AGATHA = { campaign: 'JUNIO082026M', curso: 'KODOMO', salon: '06' }

test('caso real: taller de AGOSTO · KODOMO no es para una alumna de JUNIO · KODOMO', () => {
  const taller = { campaign: 'AGOSTO172026M', curso: 'KODOMO', salon: 'Todos' }
  expect(motivoFueraDeAlcance(taller, AGATHA)).toBe('es de la campaña AGOSTO172026M')
})

test('el comodín "Todos" (o vacío) abre cada dimensión', () => {
  expect(eventoEnAlcance({ campaign: 'Todos', curso: 'Todos', salon: 'Todos' }, AGATHA)).toBe(true)
  expect(eventoEnAlcance({ campaign: '', curso: null, salon: undefined }, AGATHA)).toBe(true)
  expect(eventoEnAlcance({ campaign: 'JUNIO082026M', curso: 'KODOMO', salon: 'Todos' }, AGATHA)).toBe(true)
})

test('compara sin mayúsculas ni espacios de más', () => {
  expect(eventoEnAlcance({ campaign: ' junio082026m ', curso: 'kodomo', salon: '06' }, AGATHA)).toBe(true)
})

test('el salón puede ser una lista', () => {
  expect(eventoEnAlcance({ campaign: 'JUNIO082026M', curso: 'KODOMO', salon: '01, 06' }, AGATHA)).toBe(true)
  expect(motivoFueraDeAlcance({ campaign: 'JUNIO082026M', curso: 'KODOMO', salon: '01, 03' }, AGATHA)).toBe('es del salón 01, 03')
})

test('otro curso se rechaza', () => {
  expect(motivoFueraDeAlcance({ campaign: 'Todos', curso: 'YOJI', salon: 'Todos' }, AGATHA)).toBe('es del curso YOJI')
})

test('si al alumno le falta un dato, esa dimensión no lo restringe (igual que la lista)', () => {
  expect(eventoEnAlcance({ campaign: 'AGOSTO172026M', curso: 'KODOMO', salon: '06' }, { curso: 'KODOMO', salon: '06' })).toBe(true)
})
