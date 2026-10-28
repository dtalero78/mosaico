import { test, expect } from '@playwright/test'
import { cursosVisiblesContrato } from '../../src/lib/cursos-campaign'

/**
 * Extemporánea desde la campaña DICIEMBRE072026M: cada curso tiene su ventana de dos
 * semanas desde el día de inicio o, si se creó después de empezar, desde su creación.
 * Las campañas anteriores conservan la regla vieja.
 */
const row = (campaign: string, ini: string, fin: string, creadoEn: string, salon = '1') =>
  ({ campaign, tipoCurso: 'YOJI', salon, inicioCurso: ini, finalCurso: fin, creadoEn })

// "Hoy" = 12-ene-2027, 13:00 Chile. Matrícula: ENERO1... (en matrícula); anterior: DICIEMBRE.
const now = new Date('2027-01-12T16:00:00Z')
const enMatricula = row('ENERO112027M', '2027-01-11', '2027-09-11', '2026-12-01', 'x')

test('curso que empezó hace menos de 2 semanas: entra; hace más: sale', () => {
  const ok = row('DICIEMBRE072026M', '2026-12-30', '2027-08-30', '2026-12-01', 'a')
  const viejo = row('DICIEMBRE072026M', '2026-12-07', '2027-08-07', '2026-12-01', 'b')
  const r = cursosVisiblesContrato([ok, viejo, enMatricula], true, now).map(x => x.salon)
  expect(r).toEqual(['a'])
})

test('curso creado después de empezar: la ventana corre desde su creación', () => {
  const tardio = row('DICIEMBRE072026M', '2026-12-07', '2027-08-07', '2027-01-05', 'c')
  const r = cursosVisiblesContrato([tardio, enMatricula], true, now).map(x => x.salon)
  expect(r).toEqual(['c'])
})
