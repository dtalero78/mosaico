import { test, expect } from '@playwright/test'
import {
  aNumero, montoCoincide, medioDelCatalogo, normalizarExtraido, reciboPermitido, resumenRecibo, avisoDestino,
} from '../../src/lib/recibo-inscripcion'

/**
 * Reglas del recibo de inscripción.
 *
 * Lo que importa fijar: el monto leído se compara contra la inscripción y SÓLO
 * si coincide se precarga la cuota #0 — una lectura que confunde separadores de
 * miles con decimales precargaría la cuota con datos de otro pago. Y el medio de
 * pago leído sólo se escribe si es una opción del catálogo de la plataforma:
 * escribir otro valor lo dejaría imposible de elegir al editar el pago.
 */

test('aNumero entiende los formatos de monto de los comprobantes', () => {
  expect(aNumero(115000)).toBe(115000)
  expect(aNumero('115.000')).toBe(115000)          // miles con punto (Chile)
  expect(aNumero('$1.150.000')).toBe(1150000)
  expect(aNumero('115,000.00')).toBe(115000)       // miles con coma + decimales
  expect(aNumero('99,5')).toBe(99.5)
  expect(aNumero('')).toBeNull()
  expect(aNumero(null)).toBeNull()
  expect(aNumero('sin monto')).toBeNull()
})

test('montoCoincide tolera 1 peso y nunca da sí sin los dos montos', () => {
  expect(montoCoincide(115000, 115000)).toBe(true)
  expect(montoCoincide(115001, 115000)).toBe(true)
  expect(montoCoincide(116000, 115000)).toBe(false)
  expect(montoCoincide(null, 115000)).toBe(false)
  expect(montoCoincide(115000, null)).toBe(false)
  expect(montoCoincide(0, 0)).toBe(false)          // inscripción 0: nada que comparar
})

test('medioDelCatalogo sólo devuelve opciones del catálogo de la plataforma', () => {
  expect(medioDelCatalogo('WebPay', 'Chile')).toBe('Webpay')
  expect(medioDelCatalogo('Transferencia bancaria', 'Chile')).toBe('Transferencia')
  expect(medioDelCatalogo('Nequi', 'Chile')).toBeNull()          // no existe en Chile
  expect(medioDelCatalogo('Bancolombia', 'Colombia')).toBe('Bancolombia')
  expect(medioDelCatalogo(null, 'Chile')).toBeNull()
})

test('normalizarExtraido descarta fechas mal formadas y acota la confianza', () => {
  const e = normalizarExtraido({ medioPago: ' Webpay ', fecha: '30/09/2026', monto: '115.000', confianza: 3 })
  expect(e.medioPago).toBe('Webpay')
  expect(e.fecha).toBeNull()
  expect(e.monto).toBe(115000)
  expect(e.confianza).toBe(1)
  expect(normalizarExtraido({ fecha: '2026-09-30' }).fecha).toBe('2026-09-30')
})

test('el recibo admite imagen o PDF, no HEIC ni audio', () => {
  expect(reciboPermitido('image/jpeg', 'a.jpg')).toBe(true)
  expect(reciboPermitido('application/pdf', 'a.pdf')).toBe(true)
  expect(reciboPermitido('', 'COMPROBANTE.PNG')).toBe(true)
  expect(reciboPermitido('image/heic', 'a.heic')).toBe(false)
  expect(reciboPermitido('audio/ogg', 'nota.ogg')).toBe(false)
})

test('resumenRecibo arma la línea que se ve en el modal', () => {
  expect(resumenRecibo({ medioPago: 'Webpay', fecha: '2026-09-30', monto: 115000, referencia: '123', banco: null, confianza: 0.9 }))
    .toBe('Webpay · $115.000 · 2026-09-30 · ref 123')
  expect(resumenRecibo(null)).toBe('')
})

test('papeleta a mano: un monto igual a una denominación impresa se descarta y se pide digitarlo', () => {
  const e = normalizarExtraido({ monto: 20000, manuscrito: true, tipoDocumento: 'DEPOSITO_CAJA', ilegibles: [] })
  expect(e.monto).toBeNull()
  expect(e.ilegibles).toContain('monto')
  expect(e.tipoDocumento).toBe('PAPELETA_MANUSCRITA')
})

test('un comprobante de app no se toca: monto 115.000 y sin ilegibles', () => {
  const e = normalizarExtraido({ monto: 115000, tipoDocumento: 'APP_TRANSFERENCIA', app: 'Mach' })
  expect(e.monto).toBe(115000)
  expect(e.ilegibles).toEqual([])
  expect(e.app).toBe('Mach')
})

test('campos ilegibles inventados se ignoran', () => {
  expect(normalizarExtraido({ ilegibles: ['fecha', 'cualquiera'] }).ilegibles).toEqual(['fecha'])
})

test('avisoDestino: coincide por RUT o por cuenta de MOSAICO; avisa si es otro destinatario', () => {
  const ok = { medioPago: null, fecha: null, monto: null, referencia: null, banco: null, confianza: 1 } as any
  expect(avisoDestino({ ...ok, destino: { titular: 'Mosaico Chile Spa', rut: '77.744.966-4', cuenta: null } }, 'Chile')).toBeNull()
  expect(avisoDestino({ ...ok, destino: { titular: null, rut: null, cuenta: '23572272630' } }, 'Chile')).toBeNull()
  expect(avisoDestino({ ...ok, destino: { titular: 'Otra SpA', rut: '76.111.222-3', cuenta: '999' } }, 'Chile')).toContain('no coincide')
  expect(avisoDestino({ ...ok, destino: { titular: 'Otra SpA', rut: '76.111.222-3', cuenta: null } }, 'Colombia')).toBeNull()
  expect(avisoDestino({ ...ok, destino: { titular: null, rut: null, cuenta: null } }, 'Chile')).toBeNull()
})

test('Efectivo existe en el catálogo de medios de Chile', () => {
  expect(medioDelCatalogo('Efectivo', 'Chile')).toBe('Efectivo')
})
