import { test, expect } from '@playwright/test'
import { fillContractTemplate } from '../../src/lib/contract-template-filler'

/**
 * Qué saldo imprime el CONTRATO.
 *
 * Es lo que se confunde, y por eso se fija aquí: en FINANCIEROS hay UNA fila
 * por contrato y `saldo` NO es el que se firmó — lo reescribe
 * `syncFinancieroSaldo` con cada pago validado, así que es el "Saldo a la
 * Fecha" de la pestaña Financiera de /person y baja mes a mes.
 *
 * El contrato es el documento firmado: debe decir lo que se pactó, y regenerar
 * el PDF meses después no puede producir un texto distinto del que aceptó el
 * cliente. Se deriva de `totalPlan − pagoInscripcion`, las dos inmutables.
 */

/** El fragmento de la cláusula económica tal como está en las 3 plantillas. */
const PLANTILLA =
  'El valor del programa y el material didáctico es de ${{totalPlan}}.- ' +
  'Inscripción de ${{pagoInscripcion}}.- Saldo ${{saldo}}.- ' +
  'Pago del Saldo en {{numeroCuotas}} cuotas.'

const titular: any = { primerNombre: 'ANA', primerApellido: 'PEREZ' }

/** Lo que imprime el contrato en el hueco "Saldo $…". */
function saldoImpreso(financial: any): string {
  const out = fillContractTemplate(PLANTILLA, titular, [], financial, { hasConsent: false })
  const m = out.match(/Saldo \$([\d]+)\./)
  return m ? m[1] : ''
}

test.describe('El saldo del contrato es el de la FIRMA, no el vivo', () => {
  test('ignora FINANCIEROS.saldo cuando ya bajó por pagos validados', () => {
    // Firmó debiendo 1.035.000; después abonó una cuota y el saldo vivo cayó.
    const financial = { totalPlan: '1150000', pagoInscripcion: '115000', saldo: '920000', numeroCuotas: 9 }
    expect(saldoImpreso(financial)).toBe('1035000')
  })

  test('ignora FINANCIEROS.saldo cuando está inflado por la inscripción sin verificar', () => {
    // La cuota #0 nace sin validar, así que el saldo vivo es el plan COMPLETO.
    // Imprimirlo dejaba la cláusula contradiciéndose: "Inscripción de $146.000
    // — Saldo $1.280.000" con un plan de 1.280.000.
    const financial = { totalPlan: '1280000', pagoInscripcion: '146000', saldo: '1280000', numeroCuotas: 9 }
    expect(saldoImpreso(financial)).toBe('1134000')
  })

  test('el contrato sano no cambia — la resta da lo mismo que el saldo guardado', () => {
    const financial = { totalPlan: '1160000', pagoInscripcion: '125000', saldo: '1035000', numeroCuotas: 9 }
    expect(saldoImpreso(financial)).toBe('1035000')
  })

  test('sin inscripción el saldo es el plan entero', () => {
    expect(saldoImpreso({ totalPlan: '900000', pagoInscripcion: null, saldo: '0' })).toBe('900000')
  })

  test('una inscripción que cubre el plan deja saldo 0, nunca negativo', () => {
    expect(saldoImpreso({ totalPlan: '990000', pagoInscripcion: '990000', saldo: '990000' })).toBe('0')
  })

  test('tolera un monto tecleado con separadores de miles', () => {
    // Hoy las 686 filas son dígitos puros, pero un valor editado a mano no debe
    // romper la resta: el punto es separador de MILES, no decimal.
    expect(saldoImpreso({ totalPlan: '1.160.000', pagoInscripcion: '125.000', saldo: 'x' })).toBe('1035000')
  })

  test('sin totalPlan cae al valor guardado antes que imprimir un vacío', () => {
    expect(saldoImpreso({ totalPlan: null, pagoInscripcion: '125000', saldo: '777000' })).toBe('777000')
  })
})
