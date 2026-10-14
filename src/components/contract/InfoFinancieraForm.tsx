'use client'

import { VIGENCIA_MODULO, VIGENCIA_MIN, VIGENCIA_MAX } from '@/lib/vigencia-modulo'
import { mediosPagoContrato } from '@/lib/medios-pago'
import { calcularDerivados, vigenciaAlActivarModulo, type InfoFinanciera } from '@/lib/info-financiera'

/**
 * Formulario de la Información Financiera del contrato: el paso 6 de Crear
 * Contrato y el modal «InfoFinanciera» del detalle del contrato. Un solo
 * componente para que los dos no puedan divergir.
 *
 * Saldo y valor de cuota se recalculan solos (`calcularDerivados`); el servidor
 * los vuelve a calcular al guardar.
 */
const formatNumber = (value: string | number): string => {
  const num = typeof value === 'string' ? value.replace(/\D/g, '') : String(value ?? 0)
  return Number(num || 0).toLocaleString('es-CO')
}
const soloDigitos = (v: string) => Number(String(v).replace(/\D/g, '')) || 0

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500'

export default function InfoFinancieraForm({
  value, onChange, pais, titulo = 'Información Financiera',
}: {
  value: InfoFinanciera
  onChange: (next: InfoFinanciera) => void
  /** País/plataforma del titular: define los medios de pago. */
  pais?: string | null
  titulo?: string | null
}) {
  const f = value
  /** Aplica un cambio y recalcula saldo y cuota. */
  const set = (patch: Partial<InfoFinanciera>) => {
    const next = { ...f, ...patch }
    onChange({ ...next, ...calcularDerivados(next) })
  }

  return (
    <div className="space-y-4">
      {titulo && <h2 className="text-xl font-semibold mb-4">{titulo}</h2>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-total">Total del plan *</label>
          <input id="fin-total" type="text" inputMode="numeric" value={formatNumber(f.totalPlan)}
            onChange={(e) => set({ totalPlan: soloDigitos(e.target.value) })} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-insc">Pago inscripción *</label>
          <input id="fin-insc" type="text" inputMode="numeric" value={formatNumber(f.pagoInscripcion)}
            onChange={(e) => set({ pagoInscripcion: soloDigitos(e.target.value) })} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-saldo">Saldo</label>
          <input id="fin-saldo" type="text" value={formatNumber(f.saldo)} readOnly
            className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-cuotas">Número de cuotas / Tipo Plan</label>
          <div className="grid grid-cols-2 gap-2">
            <input id="fin-cuotas" type="number" min="0" max="99" placeholder="Cuotas"
              value={f.numeroCuotas}
              onChange={(e) => set({ numeroCuotas: Math.min(99, Math.max(0, Number(e.target.value) || 0)) })}
              className={inputCls} />
            <select aria-label="Tipo Plan" title="Tipo Plan" value={f.tipoPlan}
              onChange={(e) => set({ tipoPlan: e.target.value as any })} className={inputCls}>
              <option value="">Tipo plan</option>
              <option value="Contado">Contado</option>
              <option value="Credito">Credito</option>
              <option value="Colaborador">Colaborador</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-cuota">Valor cuota</label>
          <input id="fin-cuota" type="text" value={formatNumber(f.valorCuota)} readOnly
            className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-fecha">Fecha de pago *</label>
          <input id="fin-fecha" type="date" value={f.fechaPago}
            onChange={(e) => set({ fechaPago: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Módulo / Vigencia *{' '}
            <span className="text-xs text-gray-400">
              {f.modulo ? `(módulo: ${VIGENCIA_MODULO} meses fijos)` : `(meses, ${VIGENCIA_MIN}–${VIGENCIA_MAX})`}
            </span>
          </label>
          <div className="flex items-stretch gap-3">
            {/* Módulo: fija la vigencia en 3 meses y bloquea el campo. */}
            <button type="button" role="switch" aria-checked={f.modulo}
              title={f.modulo
                ? 'Contrato Módulo: vigencia fija de 3 meses. Click para desactivar.'
                : 'Activar si el contrato es un Módulo (vigencia de 3 meses).'}
              onClick={() => {
                const activar = !f.modulo
                // Al desactivar se deja el 3 (está en rango) para que se ajuste a mano.
                set({ modulo: activar, vigencia: activar ? vigenciaAlActivarModulo : f.vigencia })
              }}
              className={`flex shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors ${
                f.modulo ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}>
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${f.modulo ? 'bg-white/40' : 'bg-gray-300'}`}>
                <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${f.modulo ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </span>
              Módulo
            </button>
            <input type="number" aria-label="Vigencia en meses"
              min={f.modulo ? VIGENCIA_MODULO : VIGENCIA_MIN}
              max={f.modulo ? VIGENCIA_MODULO : VIGENCIA_MAX}
              value={f.vigencia} readOnly={f.modulo}
              onKeyDown={(e) => {
                if (!/^\d$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) e.preventDefault()
              }}
              onChange={(e) => {
                if (f.modulo) return
                const raw = e.target.value.replace(/[^0-9]/g, '')
                if (raw === '') { set({ vigencia: '' }); return }
                // Sólo una cifra: el rango 3–9 no admite dos dígitos.
                const num = parseInt(raw.slice(-1), 10)
                if (!isNaN(num) && num >= 1 && num <= VIGENCIA_MAX) set({ vigencia: String(num) })
              }}
              onBlur={(e) => {
                if (f.modulo) return
                const num = parseInt(e.target.value, 10)
                if (isNaN(num) || num < VIGENCIA_MIN) set({ vigencia: String(VIGENCIA_MIN) })
                else if (num > VIGENCIA_MAX) set({ vigencia: String(VIGENCIA_MAX) })
              }}
              className={`${inputCls} ${f.modulo ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : ''}`}
              placeholder={`${VIGENCIA_MIN} – ${VIGENCIA_MAX}`} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fin-medio">Medio de pago *</label>
          <select id="fin-medio" value={f.medioPago} onChange={(e) => set({ medioPago: e.target.value })} className={inputCls}>
            <option value="">Seleccione</option>
            {/* Un valor guardado que ya no está en el catálogo se conserva visible. */}
            {f.medioPago && !mediosPagoContrato(pais).some(o => o.value === f.medioPago) && (
              <option value={f.medioPago}>{f.medioPago} (actual)</option>
            )}
            {mediosPagoContrato(pais).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
