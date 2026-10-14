import { test, expect } from '@playwright/test'
import { calcularDerivados, validarInfoFinanciera, INFO_FINANCIERA_VACIA, type InfoFinanciera } from '../../src/lib/info-financiera'

/**
 * Info financiera del contrato: el paso 6 de Crear Contrato y el botón
 * «InfoFinanciera» comparten estas reglas, y el servidor las vuelve a aplicar.
 */
const ok: InfoFinanciera = {
  ...INFO_FINANCIERA_VACIA,
  totalPlan: 1150000, pagoInscripcion: 115000, numeroCuotas: 9,
  ...calcularDerivados({ totalPlan: 1150000, pagoInscripcion: 115000, numeroCuotas: 9 }),
  tipoPlan: 'Credito', fechaPago: '2026-10-13', vigencia: '9', modulo: false, medioPago: 'Transferencia',
}

test('saldo = total − inscripción y cuota = saldo / cuotas', () => {
  expect(calcularDerivados({ totalPlan: 1150000, pagoInscripcion: 115000, numeroCuotas: 9 }))
    .toEqual({ saldo: 1035000, valorCuota: 115000 })
})

test('contado (0 cuotas): la cuota es 0, no infinito', () => {
  expect(calcularDerivados({ totalPlan: 990000, pagoInscripcion: 990000, numeroCuotas: 0 }))
    .toEqual({ saldo: 0, valorCuota: 0 })
})

test('un formulario completo es válido', () => {
  expect(validarInfoFinanciera(ok)).toBeNull()
})

test('rechaza lo que el paso 6 no deja pasar', () => {
  expect(validarInfoFinanciera({ ...ok, totalPlan: 0 })).toMatch(/total/i)
  expect(validarInfoFinanciera({ ...ok, pagoInscripcion: 2000000 })).toMatch(/inscripción/i)
  expect(validarInfoFinanciera({ ...ok, fechaPago: '' })).toMatch(/fecha/i)
  expect(validarInfoFinanciera({ ...ok, medioPago: '' })).toMatch(/medio/i)
  expect(validarInfoFinanciera({ ...ok, vigencia: '12' })).toMatch(/vigencia/i)
  expect(validarInfoFinanciera({ ...ok, tipoPlan: 'Otro' as any })).toMatch(/plan/i)
})

test('un contrato Módulo sólo admite 3 meses', () => {
  expect(validarInfoFinanciera({ ...ok, modulo: true, vigencia: '3' })).toBeNull()
  expect(validarInfoFinanciera({ ...ok, modulo: true, vigencia: '6' })).toMatch(/Módulo/)
})
