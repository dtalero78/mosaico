import { test, expect } from '@playwright/test'
import { rangoUltimoMes } from '../../src/lib/justificacion'

/**
 * Gestión Justificación abre con el ÚLTIMO MES: del mismo día del mes anterior a
 * hoy, en hora de Chile. Se fijan los bordes que rompen la cuenta ingenua.
 */
// 12:00 Chile ≈ 15:00/16:00 UTC según el horario; se usa 16:00Z para no caer en otro día.
const en = (iso: string) => new Date(`${iso}T16:00:00Z`)

test('un día cualquiera: mismo día del mes anterior', () => {
  expect(rangoUltimoMes(en('2026-10-14'))).toEqual({ desde: '2026-09-14', hasta: '2026-10-14' })
})

test('31 de marzo: el mes anterior no tiene 31, cae en el último de febrero', () => {
  expect(rangoUltimoMes(en('2027-03-31'))).toEqual({ desde: '2027-02-28', hasta: '2027-03-31' })
})

test('enero cruza al diciembre del año anterior', () => {
  expect(rangoUltimoMes(en('2027-01-15'))).toEqual({ desde: '2026-12-15', hasta: '2027-01-15' })
})

test('el día se toma en Chile: a las 01:00 UTC todavía es el día anterior allá', () => {
  // 2026-10-15 01:00Z = 2026-10-14 22:00 en Chile (UTC-3).
  expect(rangoUltimoMes(new Date('2026-10-15T01:00:00Z')).hasta).toBe('2026-10-14')
})
