import { test, expect } from '@playwright/test'
import {
  motivoNoRecuperable, detalleRecuperado, marcarRecuperada, conteoAlRecuperar,
} from '../../src/lib/nivelacion-recuperacion'
import { debeCancelarse, fechaCicloConfirmacion } from '../../src/lib/nivelacion-confirmacion'

/**
 * Recuperar a Solicitudes una nivelación cancelada por el cron. La entrada es la
 * forma real que escribe el cron (16-oct-2026), con la solicitud completa que
 * guarda desde ese mismo cambio.
 */
const SOLICITUD = {
  leccion: 'Leccion 08', modulo: 'Modulo 01', hora: '18:00', duracionMin: 30,
  motivo: 'Refuerzo de restas', fecha: '2026-10-10T20:00:00.000Z', marcadoPor: 'guia@mosaico.cl',
  grupoId: 'abc', devueltaEn: '2026-10-12T10:00:00.000Z',
}
const ENTRADA = {
  fecha: '2026-10-17T01:00:05.000Z',
  fechaEvento: null,
  fechaSolicitud: '2026-10-10T20:00:00.000Z',
  modulo: 'Modulo 01', leccion: 'Leccion 08',
  conteo: 1, resultado: 'CANCELADA_SIN_CONFIRMAR',
  comentario: 'Cancelada automáticamente…', marcadoPor: 'cron@lgs-plataforma.com',
  solicitud: SOLICITUD,
}
const AHORA = new Date('2026-10-17T15:00:00.000Z') // viernes 12:00 Chile
const OK = { esUltima: true, tieneNivelacionViva: false }

test('se recupera sólo una cancelada sin confirmar, la última y sin otra viva', () => {
  expect(motivoNoRecuperable(ENTRADA, OK)).toBeNull()
  expect(motivoNoRecuperable({ ...ENTRADA, resultado: 'REMOVIDA' }, OK)).toMatch(/sólo se recuperan/)
  expect(motivoNoRecuperable({ ...ENTRADA, resultado: 'REALIZADA' }, OK)).toMatch(/sólo se recuperan/)
  expect(motivoNoRecuperable({ ...ENTRADA, recuperadaEn: '2026-10-16T00:00:00Z' }, OK)).toMatch(/ya fue recuperada/)
  expect(motivoNoRecuperable(ENTRADA, { ...OK, esUltima: false })).toMatch(/otra nivelación después/)
  expect(motivoNoRecuperable(ENTRADA, { ...OK, tieneNivelacionViva: true })).toMatch(/en curso/)
  expect(motivoNoRecuperable(null, OK)).toMatch(/ya no está/)
})

test('el detalle recuperado trae la solicitud completa, sin grupo ni confirmación', () => {
  const det = detalleRecuperado(ENTRADA, 'Servicio', AHORA)
  expect(det).toMatchObject({
    leccion: 'Leccion 08', modulo: 'Modulo 01', hora: '18:00', duracionMin: 30,
    motivo: 'Refuerzo de restas', marcadoPor: 'guia@mosaico.cl',
    fecha: '2026-10-10T20:00:00.000Z', // la original se conserva para mostrarla
    recuperadaEn: AHORA.toISOString(), recuperadaPor: 'Servicio',
  })
  expect(det).not.toHaveProperty('grupoId')
  expect(det).not.toHaveProperty('devueltaEn')
  expect(det).not.toHaveProperty('confirmadoEn')
})

test('una cancelada antes de guardar la solicitud vuelve con módulo, lección y fecha', () => {
  const { solicitud: _s, ...vieja } = ENTRADA
  const det = detalleRecuperado(vieja, 'Servicio', AHORA)
  expect(det).toMatchObject({ modulo: 'Modulo 01', leccion: 'Leccion 08', fecha: '2026-10-10T20:00:00.000Z' })
  expect(det).not.toHaveProperty('hora')
})

test('el plazo corre desde la recuperación: el cron no la vuelve a cancelar de inmediato', () => {
  const det = detalleRecuperado(ENTRADA, 'Servicio', AHORA)
  expect(fechaCicloConfirmacion(det)).toBe(AHORA.toISOString())
  // Con la fecha original, el corte (jueves 15-oct 22:00) ya pasó: se cancelaría.
  expect(debeCancelarse({ fecha: SOLICITUD.fecha }, AHORA)).toBe(true)
  // Recuperada el viernes 16: el corte pasa al jueves 22-oct 22:00 Chile.
  expect(debeCancelarse(det, AHORA)).toBe(false)
  expect(debeCancelarse(det, new Date('2026-10-23T00:59:00.000Z'))).toBe(false) // jue 21:59
  expect(debeCancelarse(det, new Date('2026-10-23T01:00:00.000Z'))).toBe(true)  // jue 22:00
})

test('la entrada se marca recuperada y el conteo devuelve el que quitó el cron', () => {
  const m = marcarRecuperada(ENTRADA, 'Servicio', AHORA)
  expect(m).toMatchObject({ resultado: 'CANCELADA_SIN_CONFIRMAR', recuperadaEn: AHORA.toISOString(), recuperadaPor: 'Servicio' })
  expect(conteoAlRecuperar(0)).toBe(1)
  expect(conteoAlRecuperar(2)).toBe(3)
  expect(conteoAlRecuperar(null)).toBe(1)
})
