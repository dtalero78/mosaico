import { VIGENCIA_MODULO, vigenciaValida, mensajeVigenciaInvalida } from '@/lib/vigencia-modulo'

/**
 * Información financiera del contrato (paso 6 de Crear Contrato y botón
 * «InfoFinanciera» del detalle). Reglas puras, cliente y servidor: el formulario
 * muestra con ellas el saldo y la cuota, y el servidor las vuelve a aplicar sin
 * fiarse de lo que mande el navegador.
 */

export const TIPOS_PLAN = ['Contado', 'Credito', 'Colaborador'] as const
export type TipoPlanFin = typeof TIPOS_PLAN[number]

export interface InfoFinanciera {
  totalPlan: number
  pagoInscripcion: number
  /** Saldo A LA FIRMA = total − inscripción (no el saldo vivo de cobranza). */
  saldo: number
  numeroCuotas: number
  valorCuota: number
  tipoPlan: '' | TipoPlanFin
  fechaPago: string
  vigencia: string
  modulo: boolean
  medioPago: string
}

export const INFO_FINANCIERA_VACIA: InfoFinanciera = {
  totalPlan: 0, pagoInscripcion: 0, saldo: 0, numeroCuotas: 0, valorCuota: 0,
  tipoPlan: '', fechaPago: '', vigencia: '', modulo: false, medioPago: '',
}

/** Recalcula los derivados: saldo = total − inscripción; cuota = saldo / cuotas. */
export function calcularDerivados<T extends Pick<InfoFinanciera, 'totalPlan' | 'pagoInscripcion' | 'numeroCuotas'>>(f: T) {
  const saldo = (Number(f.totalPlan) || 0) - (Number(f.pagoInscripcion) || 0)
  const cuotas = Number(f.numeroCuotas) || 0
  return { saldo, valorCuota: cuotas > 0 ? Math.round(saldo / cuotas) : 0 }
}

/** Primer problema del formulario, o null si se puede guardar. Mismas reglas que el paso 6. */
export function validarInfoFinanciera(f: InfoFinanciera): string | null {
  if (!(Number(f.totalPlan) > 0)) return 'El total del plan debe ser mayor que 0.'
  if (!(Number(f.pagoInscripcion) >= 0)) return 'El pago de inscripción no puede ser negativo.'
  if (Number(f.pagoInscripcion) > Number(f.totalPlan)) return 'La inscripción no puede superar el total del plan.'
  const cuotas = Number(f.numeroCuotas)
  if (!Number.isInteger(cuotas) || cuotas < 0 || cuotas > 99) return 'El número de cuotas debe estar entre 0 y 99.'
  if (f.tipoPlan && !(TIPOS_PLAN as readonly string[]).includes(f.tipoPlan)) return 'Tipo de plan inválido.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.fechaPago || ''))) return 'Indica la fecha de pago.'
  if (!vigenciaValida(f.vigencia, f.modulo === true)) return mensajeVigenciaInvalida(f.modulo === true)
  if (!String(f.medioPago || '').trim()) return 'Selecciona el medio de pago.'
  return null
}

/** Al activar «Módulo» la vigencia queda fija en 3 meses. */
export const vigenciaAlActivarModulo = String(VIGENCIA_MODULO)
