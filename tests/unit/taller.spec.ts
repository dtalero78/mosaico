import { test, expect } from '@playwright/test'
import { fechaHoraTaller, tallerTerminado, etiquetaOrigenTaller } from '../../src/lib/taller'
import { fillTemplate } from '../../src/lib/message-template-filler'

/**
 * Talleres: la fecha y la hora del mensaje van SIEMPRE en hora de Chile. Los
 * instantes son los de los talleres reales del 16-oct-2026 (18:00 Chile = 21:00Z,
 * horario de verano) y uno de julio (horario de invierno, -4).
 */
test('fecha y hora del taller en hora de Chile, con y sin horario de verano', () => {
  expect(fechaHoraTaller('2026-10-16T21:00:00.000Z')).toEqual({ fecha: 'viernes 16-10-2026', hora: '18:00' })
  expect(fechaHoraTaller('2026-07-15T23:30:00.000Z')).toEqual({ fecha: 'miércoles 15-07-2026', hora: '19:30' })
  // Pasada la medianoche UTC sigue siendo el mismo día en Chile.
  expect(fechaHoraTaller('2026-10-08T01:30:00.000Z')).toEqual({ fecha: 'miércoles 07-10-2026', hora: '22:30' })
  expect(fechaHoraTaller(null)).toEqual({ fecha: '', hora: '' })
  expect(fechaHoraTaller('no es fecha')).toEqual({ fecha: '', hora: '' })
})

test('un taller sigue siendo "próximo" mientras se dicta (60 min)', () => {
  const inicio = new Date('2026-10-16T21:00:00.000Z')
  expect(tallerTerminado(inicio, new Date('2026-10-16T21:59:00.000Z'))).toBe(false)
  expect(tallerTerminado(inicio, new Date('2026-10-16T22:00:00.000Z'))).toBe(true)
})

test('origen: inscrito desde el panel o agendado por el personal', () => {
  expect(etiquetaOrigenTaller('PANEL_EST')).toBe('Se inscribió (panel)')
  expect(etiquetaOrigenTaller('POSTGRES')).toBe('Agendado por personal')
  expect(etiquetaOrigenTaller(null)).toBe('Agendado por personal')
})

test('placeholders del recordatorio', () => {
  const msg = fillTemplate(
    '¡Hola, {{nombreApoderado}}! {{nombreAlumno}} · {{curso}} · {{fechaTaller}} {{horaTaller}} hrs',
    { nombre: 'Sofía', primerApellido: 'González', apoderado: 'Carolina Rojas', curso: 'KODOMO',
      fechaTaller: 'viernes 16-10-2026', horaTaller: '18:00' }
  )
  expect(msg).toBe('¡Hola, Carolina Rojas! Sofía González · KODOMO · viernes 16-10-2026 18:00 hrs')
  // Fuera de Talleres no hay datos del taller: salen vacíos, sin romper el texto.
  expect(fillTemplate('{{fechaTaller}}|{{nombreApoderado}}', { nombre: 'X' })).toBe('|')
})
