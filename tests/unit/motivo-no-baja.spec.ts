import { test, expect } from '@playwright/test'
import { motivoNoDableDeBaja } from '../../src/services/purga-contrato.service'

/**
 * Por qué un contrato NO se puede dar de baja.
 *
 * Lo que se fija aquí es el CÓDIGO, no el texto: la pantalla decide con él si
 * ofrece «Desmarcar listo y dar de baja», y si alguien reescribe el mensaje sin
 * tocar el código, el botón tiene que seguir apareciendo igual.
 *
 * Y al revés: el código separa lo reversible de lo que no lo es. «listo» sólo
 * dice que el contrato tomó el cupo del salón —eso se suelta—, mientras que
 * aprobado y finalizado significan que hay alumnos con clases y accesos. Si los
 * tres compartieran código, el botón se ofrecería sobre un curso en marcha.
 */
test.describe('Motivo por el que un contrato no es dable de baja', () => {
  test('un contrato en gestión sí se puede dar de baja', () => {
    expect(motivoNoDableDeBaja({ aprobacion: null, gestionContratoListo: false })).toBeNull()
    expect(motivoNoDableDeBaja({ aprobacion: 'Pendiente', gestionContratoListo: null })).toBeNull()
  })

  test('el «listo» se distingue con su propio código', () => {
    const m = motivoNoDableDeBaja({ aprobacion: 'Pendiente', gestionContratoListo: true })
    expect(m?.codigo).toBe('listo')
  })

  test('aprobado y finalizado NO comparten código con «listo»', () => {
    expect(motivoNoDableDeBaja({ aprobacion: 'Aprobado', gestionContratoListo: false })?.codigo).toBe('aprobado')
    expect(motivoNoDableDeBaja({ aprobacion: 'Aprobada', gestionContratoListo: true })?.codigo).toBe('aprobado')
    expect(motivoNoDableDeBaja({ aprobacion: 'FINALIZADA', gestionContratoListo: false })?.codigo).toBe('finalizado')
  })

  test('aprobado manda sobre listo: un curso en marcha nunca se ofrece revertir', () => {
    // Si el orden se invirtiera, un contrato aprobado Y listo saldría como
    // «listo» y la pantalla ofrecería desmarcarlo y borrarlo.
    const m = motivoNoDableDeBaja({ aprobacion: 'aprobado', gestionContratoListo: true })
    expect(m?.codigo).toBe('aprobado')
  })

  test('el estado se lee sin distinguir mayúsculas ni espacios al borde', () => {
    expect(motivoNoDableDeBaja({ aprobacion: '  APROBADO  ', gestionContratoListo: false })?.codigo).toBe('aprobado')
    expect(motivoNoDableDeBaja({ aprobacion: ' finalizada ', gestionContratoListo: false })?.codigo).toBe('finalizado')
  })

  test('«listo» es true, no cualquier valor con el que se confunda', () => {
    // La columna admite NULL, y un NULL no es una marca puesta por nadie.
    expect(motivoNoDableDeBaja({ aprobacion: null, gestionContratoListo: null })).toBeNull()
    expect(motivoNoDableDeBaja({ aprobacion: null, gestionContratoListo: false })).toBeNull()
  })
})
