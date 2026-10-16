import { test, expect } from '@playwright/test'
import {
  METRICAS, METRICAS_MANUALES, sanitizeCriterios, puedeEnviarseAlApoderado,
} from '../../src/services/reporte-academico.service'

/**
 * Reporte Académico (oct-2026): «cámara y micrófono» se separó en dos criterios,
 * y el informe sólo se envía al apoderado con el cierre definitivo.
 */
test('cámara y micrófono son dos criterios, cada uno con su columna', () => {
  const camara = METRICAS_MANUALES.find(m => m.key === 'camara')
  const micro = METRICAS_MANUALES.find(m => m.key === 'microfono')
  expect(camara?.col).toBe('acDisposicion')
  expect(micro?.col).toBe('acMicrofono')
  expect(micro?.grupo).toBe('ACTITUDES')
  // Asistió + 9 de la rúbrica.
  expect(METRICAS.length).toBe(10)
  expect(METRICAS.filter(m => m.grupo === 'ACTITUDES').length).toBe(4)
})

test('las correcciones del reporte aceptan micrófono', () => {
  expect(sanitizeCriterios({ camara: 'full', microfono: 'half', otro: 'full', respeto: 'x' }))
    .toEqual({ camara: 'full', microfono: 'half' })
})

test('sólo el informe cerrado en definitivo se envía al apoderado', () => {
  expect(puedeEnviarseAlApoderado('DEFINITIVO')).toBe(true)
  expect(puedeEnviarseAlApoderado('CERRADO_GUIA')).toBe(false)
  expect(puedeEnviarseAlApoderado('BORRADOR')).toBe(false)
})
