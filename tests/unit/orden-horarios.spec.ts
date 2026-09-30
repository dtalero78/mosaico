import { test, expect } from '@playwright/test'
import { compararHorarios, ordenarHorarios } from '../../src/lib/cursos-campaign'

/**
 * Orden de presentación de los horarios: día de la semana (lunes primero, domingo
 * al final), luego hora de inicio, luego texto. Es lo que ve la persona en el
 * catálogo y en todos los desplegables; antes mandaba el `orden` del seed y el
 * texto, así que un horario agregado después caía detrás de los sábados.
 */
const ordenar = (xs: string[]) => [...xs].sort(compararHorarios)

test('los días van de lunes a sábado aunque el texto diga otra cosa', () => {
  // Alfabético daría JUE < LUN < MAR < MIÉ < SÁB < VIE: no sirve.
  expect(ordenar(['SÁB 09:00-11:00', 'VIE 17:00-18:00', 'JUE 17:00-18:00', 'MAR-JUE 17:00-18:00', 'LUN-MIÉ 17:00-18:00', 'MIÉ 17:00-18:00']))
    .toEqual(['LUN-MIÉ 17:00-18:00', 'MAR-JUE 17:00-18:00', 'MIÉ 17:00-18:00', 'JUE 17:00-18:00', 'VIE 17:00-18:00', 'SÁB 09:00-11:00'])
})

test('el caso real de DANSHI: los agregados después ya no caen detrás de los sábados', () => {
  // Orden con el que salían (por `orden` del seed, los 999 al final).
  const comoSalian = [
    'LUN-MIÉ 19:00-19:50', 'MAR-JUE 19:00-19:50', 'SÁB 09:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00',
    'LUN-MIÉ 19:15-20:05', 'MAR-JUE 19:15-20:15', 'MAR-JUE 20:00-20:50', 'SÁB 11:15-13:15',
  ]
  expect(ordenar(comoSalian)).toEqual([
    'LUN-MIÉ 19:00-19:50', 'LUN-MIÉ 19:15-20:05',
    'MAR-JUE 19:00-19:50', 'MAR-JUE 19:15-20:15', 'MAR-JUE 20:00-20:50',
    'SÁB 09:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00', 'SÁB 11:15-13:15',
  ])
})

test('dentro del mismo día manda la hora de inicio, no el texto', () => {
  // "09:00" < "10:00" también alfabéticamente, pero "9:00" (sin cero) no: se compara en minutos.
  expect(ordenar(['SÁB 11:00-13:00', 'SÁB 9:00-11:00', 'SÁB 10:00-12:00'])).toEqual(['SÁB 9:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00'])
})

test('un horario de varios días se ordena por el PRIMER día que tiene', () => {
  expect(ordenar(['MAR-JUE 17:00-18:00', 'LUN-MIÉ-VIE 20:00-21:00', 'LUN-MIÉ 18:15-19:15']))
    .toEqual(['LUN-MIÉ 18:15-19:15', 'LUN-MIÉ-VIE 20:00-21:00', 'MAR-JUE 17:00-18:00'])
})

test('domingo va al final, y con o sin acento es el mismo día', () => {
  expect(ordenar(['DOM 10:00-12:00', 'SAB 09:00-11:00', 'MIE 17:00-18:00', 'LUN 17:00-18:00']))
    .toEqual(['LUN 17:00-18:00', 'MIE 17:00-18:00', 'SAB 09:00-11:00', 'DOM 10:00-12:00'])
  expect(compararHorarios('SÁB 09:00-11:00', 'SAB 09:00-11:00')).toBe(0)
})

test('lo que no se puede interpretar va al final, en orden de texto, sin desaparecer', () => {
  const r = ordenar(['zzz', 'SÁB 09:00-11:00', 'lunes 5pm', 'LUN-MIÉ 17:00-18:00', ''])
  expect(r.slice(0, 2)).toEqual(['LUN-MIÉ 17:00-18:00', 'SÁB 09:00-11:00'])
  expect(r.slice(2).sort()).toEqual(['', 'lunes 5pm', 'zzz'].sort())
  expect(r).toHaveLength(5)
})

test('ordenarHorarios ordena objetos por el horario que se le indique y no muta la lista', () => {
  const filas = [{ salon: '09', horarioCurso: 'SÁB 10:00-12:00' }, { salon: '01', horarioCurso: 'LUN-MIÉ 17:00-18:00' }, { salon: '04', horarioCurso: 'MAR-JUE 17:00-18:00' }]
  const copia = [...filas]
  expect(ordenarHorarios(filas, f => f.horarioCurso).map(f => f.salon)).toEqual(['01', '04', '09'])
  expect(filas).toEqual(copia)
})
