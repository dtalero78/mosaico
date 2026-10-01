import { test, expect } from '@playwright/test'
import { campanasExcluidasMigracion } from '../../src/lib/cursos-campaign'

/**
 * Campañas que la pestaña Migración NO toca: la que está en matrícula y la
 * inmediatamente anterior. Lo que se fija aquí es qué cuenta como "anterior":
 * la que ARRANCÓ justo antes (su primer curso), no la de nombre más parecido ni
 * la primera de la lista — una regla floja dejaría aprobar por migración
 * contratos de la venta en curso.
 */

// 1-oct-2026 12:00 de Chile.
const AHORA = new Date('2026-10-01T15:00:00Z')

const filas = [
  { campaign: 'DICIEMBRE012025M', inicioCurso: '2025-12-01', finalCurso: '2026-11-01' },
  { campaign: 'ENERO262026M', inicioCurso: '2026-01-17', finalCurso: '2026-12-30' },
  { campaign: 'ABRIL132026M', inicioCurso: '2026-04-13', finalCurso: '2027-03-20' },
  { campaign: 'JUNIO082026M', inicioCurso: '2026-06-08', finalCurso: '2027-05-20' },
  { campaign: 'AGOSTO102026I', inicioCurso: '2026-08-10', finalCurso: '2026-11-30' },
  { campaign: 'AGOSTO172026M', inicioCurso: '2026-08-17', finalCurso: '2027-07-20' },
  // La campaña arranca con su PRIMER curso: el del sábado no la retrasa.
  { campaign: 'AGOSTO172026M', inicioCurso: '2026-08-22', finalCurso: '2027-07-25' },
  { campaign: '0CTUBRE192026M', inicioCurso: '2026-10-19', finalCurso: '2027-09-20' },
]

test('excluye la campaña en matrícula y la que arrancó justo antes', () => {
  const r = campanasExcluidasMigracion(filas, AHORA)
  expect(r.enMatricula).toEqual(['0CTUBRE192026M'])
  expect(r.anterior).toBe('AGOSTO172026M')
  expect(r.excluidas.sort()).toEqual(['0CTUBRE192026M', 'AGOSTO172026M'])
})

test('las campañas anteriores quedan disponibles para la migración', () => {
  const r = campanasExcluidasMigracion(filas, AHORA)
  for (const c of ['DICIEMBRE012025M', 'ENERO262026M', 'ABRIL132026M', 'JUNIO082026M', 'AGOSTO102026I']) {
    expect(r.excluidas).not.toContain(c)
  }
})

test('sin campaña en matrícula, la anterior es la que arrancó más recientemente', () => {
  const sinOctubre = filas.filter(f => f.campaign !== '0CTUBRE192026M')
  const r = campanasExcluidasMigracion(sinOctubre, AHORA)
  expect(r.enMatricula).toEqual([])
  expect(r.anterior).toBe('AGOSTO172026M')
  expect(r.excluidas).toEqual(['AGOSTO172026M'])
})

test('una campaña dentro de su semana de matrícula cuenta como en matrícula', () => {
  // 20-oct: OCTUBRE ya empezó (19-oct), pero su matrícula sigue hasta el lunes 26 a las 09:00.
  const r = campanasExcluidasMigracion(filas, new Date('2026-10-20T15:00:00Z'))
  expect(r.enMatricula).toEqual(['0CTUBRE192026M'])
  expect(r.anterior).toBe('AGOSTO172026M')
})
