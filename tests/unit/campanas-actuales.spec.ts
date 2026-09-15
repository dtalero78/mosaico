import { test, expect } from '@playwright/test'
import { estadosDeCampanas, campanasActuales } from '../../src/lib/cursos-campaign'

/**
 * Qué campañas abre por defecto la bandeja de Welcome.
 *
 * La regla es «la que está en matrícula + la ACTIVA más reciente». Lo que se
 * fija aquí es justo lo que se confunde al leerla:
 *
 *  - el estado es de la CAMPAÑA, no de uno de sus cursos: arranca con el
 *    primero y sigue viva mientras el ÚLTIMO no haya terminado. Mirando un
 *    curso suelto, una campaña con la mitad de sus salones dictando saldría
 *    «cerrada»;
 *  - de las activas entra UNA, la más reciente. Si se tomara la primera de la
 *    lista, la bandeja abriría mostrando una promoción de hace meses.
 *
 * Las fechas se comparan contra un `now` fijo para que la prueba no dependa del
 * día en que se corra.
 */

// Jueves 10 de septiembre de 2026, mediodía en Chile (15:00Z).
const AHORA = new Date('2026-09-10T15:00:00Z')

/** Una fila de curso como la que devuelve /api/postgres/cursos-campaign. */
const curso = (campaign: string, inicioCampanaCursos: string, inicioCurso: string, finalCurso: string) =>
  ({ campaign, inicioCampanaCursos, inicioCurso, finalCurso })

test.describe('Estado de una campaña a partir de sus cursos', () => {
  test('la campaña sigue viva mientras su ÚLTIMO curso no termine', () => {
    // Un salón ya terminó, otro sigue hasta 2027: la campaña NO está cerrada.
    const rows = [
      curso('JUNIO082026M', '2026-06-08', '2026-06-08', '2026-08-30'),
      curso('JUNIO082026M', '2026-06-08', '2026-06-09', '2027-04-30'),
    ]
    const [c] = estadosDeCampanas(rows, AHORA)
    expect(c.campaign).toBe('JUNIO082026M')
    expect(c.estado).toBe('activo')
  })

  test('cuando todos sus cursos terminaron, la campaña está cerrada', () => {
    const rows = [
      curso('ENERO262026M', '2026-01-26', '2026-01-26', '2026-07-30'),
      curso('ENERO262026M', '2026-01-26', '2026-01-27', '2026-08-30'),
    ]
    expect(estadosDeCampanas(rows, AHORA)[0].estado).toBe('cerrado')
  })

  test('la matrícula se cuenta desde el PRIMER curso de la campaña', () => {
    // Los sábados empiezan días después, pero son la misma promoción: si cada
    // curso contara su propia semana, el de sábado seguiría en matrícula
    // cuando la campaña ya arrancó.
    const rows = [
      curso('SEPTIEMBRE072026M', '2026-09-07', '2026-09-07', '2027-06-30'),
      curso('SEPTIEMBRE072026M', '2026-09-07', '2026-09-12', '2027-06-30'),
    ]
    // Corte = lunes siguiente al lunes de inicio, 09:00 → lun 14-sep 09:00.
    expect(estadosDeCampanas(rows, AHORA)[0].estado).toBe('matricula')
  })
})

test.describe('Las campañas "actuales" de la bandeja de Welcome', () => {
  const rows = [
    // En matrícula (arrancó esta semana).
    curso('SEPTIEMBRE072026M', '2026-09-07', '2026-09-07', '2027-06-30'),
    // Activas: agosto es la MÁS RECIENTE, junio la anterior.
    curso('AGOSTO172026M', '2026-08-17', '2026-08-17', '2027-06-30'),
    curso('JUNIO082026M', '2026-06-08', '2026-06-08', '2027-04-30'),
    // Cerrada.
    curso('ENERO262026M', '2026-01-26', '2026-01-26', '2026-08-30'),
  ]

  test('entra la que está en matrícula y SOLO la activa más reciente', () => {
    const out = campanasActuales(rows, AHORA)
    expect(out).toContain('SEPTIEMBRE072026M')
    expect(out).toContain('AGOSTO172026M')
    expect(out).not.toContain('JUNIO082026M')
    expect(out).not.toContain('ENERO262026M')
    expect(out).toHaveLength(2)
  })

  test('el orden en que llegan las filas no cambia cuál activa entra', () => {
    const alReves = [...rows].reverse()
    expect(campanasActuales(alReves, AHORA).sort()).toEqual(campanasActuales(rows, AHORA).sort())
  })

  test('sin ninguna campaña en matrícula, queda la activa más reciente', () => {
    const sinMatricula = rows.filter((r) => r.campaign !== 'SEPTIEMBRE072026M')
    expect(campanasActuales(sinMatricula, AHORA)).toEqual(['AGOSTO172026M'])
  })

  test('sin filas devuelve vacío — y la pantalla NO esconde nada con eso', () => {
    // El vacío es la señal de "todavía no sé"; el filtro de la bandeja lo trata
    // como "no filtres", para no dejar la lista en blanco mientras carga.
    expect(campanasActuales([], AHORA)).toEqual([])
  })

  test('una campaña sin nombre se ignora', () => {
    expect(campanasActuales([curso('', '2026-09-07', '2026-09-07', '2027-06-30')], AHORA)).toEqual([])
  })
})
