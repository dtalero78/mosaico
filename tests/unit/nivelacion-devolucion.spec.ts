import { test, expect } from '@playwright/test'
import {
  motivoNoDevolvible, fechaSolicitudRestaurada, detalleDevuelto, conteoAlDevolver, marcarDevuelta,
} from '../../src/lib/nivelacion-devolucion'

const ok = { esUltima: true, tieneNivelacionViva: false }

test.describe('nivelacion-devolucion', () => {
  test('sólo devuelve cierres de inasistencia', () => {
    for (const r of ['NO_ASISTIO', 'NO_ASISTIO_JUSTIFICO', 'NO_ASISTIO_NO_CONTESTO']) {
      expect(motivoNoDevolvible({ resultado: r }, ok)).toBeNull()
    }
    expect(motivoNoDevolvible({ resultado: 'REALIZADA' }, ok)).toMatch(/No asistió/)
    expect(motivoNoDevolvible({ resultado: 'CANCELADA_SIN_CONFIRMAR' }, ok)).toMatch(/No asistió/)
  })
  test('rechaza repetida, no última, con otra viva y entrada inexistente', () => {
    const e = { resultado: 'NO_ASISTIO_NO_CONTESTO' }
    expect(motivoNoDevolvible({ ...e, devueltaPendienteEn: 'x' }, ok)).toMatch(/ya fue devuelta/)
    expect(motivoNoDevolvible(e, { esUltima: false, tieneNivelacionViva: false })).toMatch(/otra nivelación después/)
    expect(motivoNoDevolvible(e, { esUltima: true, tieneNivelacionViva: true })).toMatch(/en curso/)
    expect(motivoNoDevolvible(null, ok)).toMatch(/ya no está/)
  })
  test('la fecha de solicitud nunca queda después del agendamiento', () => {
    const ag = '2026-10-10T12:00:00.000Z'
    expect(fechaSolicitudRestaurada('2026-10-09T12:00:00.000Z', ag)).toBe('2026-10-09T12:00:00.000Z')
    expect(fechaSolicitudRestaurada('2026-10-11T12:00:00.000Z', ag)).toBe('2026-10-10T11:59:00.000Z')
    expect(fechaSolicitudRestaurada(null, ag)).toBe('2026-10-10T11:59:00.000Z')
  })
  test('el detalle conserva módulo, lección y confirmación', () => {
    const d = detalleDevuelto(
      { modulo: 'Modulo 09', leccion: 'Leccion 66', fechaSolicitud: '2026-10-01T00:00:00.000Z', confirmadoEn: '2026-10-02T00:00:00.000Z', confirmadoPor: 'SERVICIO' },
      '2026-10-10T12:00:00.000Z', 'Ana', new Date('2026-10-21T00:00:00Z'))
    expect(d).toMatchObject({ modulo: 'Modulo 09', leccion: 'Leccion 66', confirmadoPor: 'SERVICIO', devueltaPendientePor: 'Ana' })
    expect(d.fecha).toBe('2026-10-01T00:00:00.000Z')
  })
  test('el conteo sólo sube cuando el cierre del guía lo había bajado', () => {
    expect(conteoAlDevolver('NO_ASISTIO', 1)).toBe(2)
    expect(conteoAlDevolver('NO_ASISTIO_NO_CONTESTO', 1)).toBe(1)
    expect(conteoAlDevolver('NO_ASISTIO_JUSTIFICO', null)).toBe(0)
  })
  test('marca la entrada', () => {
    expect(marcarDevuelta({ resultado: 'NO_ASISTIO' }, 'Ana').devueltaPendientePor).toBe('Ana')
  })
})
