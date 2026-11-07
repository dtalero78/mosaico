'use client'

/**
 * Recaudos › Gestión › Ajustes
 *
 * Corrige registros YA VALIDADOS en tres subpestañas (cada una con su permiso,
 * SUPER_ADMIN/ADMIN ven todas):
 *   - Inscripciones → cuota #0
 *   - Pagos         → cuotas #1..N
 *   - Facturación   → número de factura
 * Cada ajuste pide motivo, recalcula los saldos del contrato ("Saldo a la Fecha"
 * y saldo por cuota) y queda en el historial (PAGOS_AJUSTES).
 */
import { useCallback, useEffect, useState } from 'react'
import FilialSelect from './FilialSelect'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon, PencilSquareIcon, XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { RecaudosPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { api, handleApiError } from '@/hooks/use-api'
import { formatCurrency } from '@/lib/utils'
import { mediosPagoPara } from '@/lib/medios-pago'

type Tipo = 'INSCRIPCION' | 'PAGO' | 'FACTURA'

interface Fila {
  _id: string
  idPeople: string
  numCuota: number | null
  fechaPago: string | null
  valorPagado: string | number | null
  descuento: string | number | null
  medioPago: string | null
  banco: string | null
  numeroReferencia: string | null
  numeroFactura: string | null
  fechaValidacion: string | null
  validadoPor: string | null
  contrato: string | null
  numeroId: string | null
  plataforma: string | null
  titular: string
  saldoContrato: string | null
}

interface Ajuste {
  _id: string
  tipo: Tipo
  contrato: string | null
  numCuota: number | null
  titular: string | null
  antes: Record<string, any>
  despues: Record<string, any>
  motivo: string
  saldoAntes: string | null
  saldoDespues: string | null
  usuarioEmail: string | null
  usuarioNombre: string | null
  _createdDate: string
}

const SUBTABS: { key: Tipo; label: string; permiso: RecaudosPermission }[] = [
  { key: 'INSCRIPCION', label: 'Inscripciones', permiso: RecaudosPermission.AJUSTES_INSCRIPCION },
  { key: 'PAGO', label: 'Pagos', permiso: RecaudosPermission.AJUSTES_PAGO },
  { key: 'FACTURA', label: 'Facturación', permiso: RecaudosPermission.AJUSTES_FACTURACION },
]

const ETIQUETA: Record<string, string> = {
  numCuota: '# Cuota', valorPagado: 'Valor pagado', descuento: 'Descuento', fechaPago: 'Fecha de pago',
  medioPago: 'Medio de pago', banco: 'Banco', numeroReferencia: 'Referencia', numeroFactura: '# Factura',
}

const num = (v: any) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const fmtFecha = (d: string | null) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('es', { timeZone: 'UTC' }) } catch { return '—' }
}
const fmtValor = (campo: string, v: any) => {
  if (v === null || v === undefined || v === '') return '—'
  if (campo === 'valorPagado' || campo === 'descuento') return formatCurrency(num(v))
  if (campo === 'fechaPago') return fmtFecha(String(v))
  return String(v)
}

export default function AjustesRecaudosPanel() {
  const { hasPermission, isLoading: permisosCargando } = usePermissions()
  const subtabs = SUBTABS.filter(s => hasPermission(s.permiso))
  const [tipo, setTipo] = useState<Tipo | null>(null)
  const [q, setQ] = useState('')
  const [filial, setFilial] = useState('')
  const [filas, setFilas] = useState<Fila[]>([])
  const [historial, setHistorial] = useState<Ajuste[]>([])
  const [loading, setLoading] = useState(false)
  const [editando, setEditando] = useState<Fila | null>(null)

  useEffect(() => {
    if (!tipo && subtabs.length) setTipo(subtabs[0].key)
  }, [tipo, subtabs])

  const cargar = useCallback(async () => {
    if (!tipo) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ tipo })
      if (q.trim()) qs.set('q', q.trim())
      if (filial) qs.set('filial', filial)
      const [r, h] = await Promise.all([
        api.get<{ pagos: Fila[] }>(`/api/postgres/recaudos/ajustes?${qs}`),
        api.get<{ ajustes: Ajuste[] }>(`/api/postgres/recaudos/ajustes?historial=1&tipo=${tipo}`),
      ])
      setFilas(r.pagos || [])
      setHistorial(h.ajustes || [])
    } catch (e) {
      handleApiError(e, 'Error cargando registros')
    } finally {
      setLoading(false)
    }
  }, [tipo, q, filial])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [tipo])

  if (permisosCargando) return null
  if (!subtabs.length) {
    return <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500">No tienes permisos de Ajustes.</div>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Corrige registros <b>ya validados</b>. Cada ajuste exige un motivo, recalcula el <b>Saldo a la Fecha</b> del contrato
        y el saldo por cuota, y queda registrado en el historial de abajo. Los pagos pendientes se editan desde Verificación.
      </div>

      {/* Subpestañas */}
      <div className="flex gap-2">
        {subtabs.map(s => (
          <button key={s.key} type="button" onClick={() => { setTipo(s.key); setFilas([]) }}
            className={`px-3 py-1.5 text-sm font-medium rounded-full border transition ${tipo === s.key ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Búsqueda */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="ajustes-q" className="block text-xs font-medium text-gray-700">Buscar (titular, documento, contrato{tipo === 'FACTURA' ? ', factura' : ''})</label>
          <div className="mt-1 relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input id="ajustes-q" type="text" value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') cargar() }}
              placeholder="Ej: 01-15221-26" className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm" />
          </div>
        </div>
        <div className="w-48"><FilialSelect id="ajustes-filial" value={filial} onChange={setFilial} /></div>
        <button type="button" onClick={cargar} disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50">
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {/* Registros validados */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">
          Registros validados ({filas.length}{filas.length === 100 ? '+, afine la búsqueda' : ''})
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Titular</th>
              <th className="px-3 py-2 text-left">Contrato</th>
              <th className="px-3 py-2 text-center"># Cuota</th>
              <th className="px-3 py-2 text-left">Fecha pago</th>
              <th className="px-3 py-2 text-right">Valor pagado</th>
              <th className="px-3 py-2 text-right">Descuento</th>
              <th className="px-3 py-2 text-left">Medio / Banco</th>
              <th className="px-3 py-2 text-left"># Factura</th>
              <th className="px-3 py-2 text-right">Saldo a la fecha</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && filas.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">Sin registros. Busque por titular, documento o contrato.</td></tr>
            )}
            {filas.map(f => (
              <tr key={f._id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <a href={`/person/${f.idPeople}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">
                    {f.titular || '—'} <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                  <div className="text-xs text-gray-400">{f.numeroId} · {f.plataforma || '—'}</div>
                </td>
                <td className="px-3 py-2">{f.contrato || '—'}</td>
                <td className="px-3 py-2 text-center">{f.numCuota ?? 0}</td>
                <td className="px-3 py-2">{fmtFecha(f.fechaPago)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatCurrency(num(f.valorPagado))}</td>
                <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(num(f.descuento))}</td>
                <td className="px-3 py-2 text-xs">{f.medioPago || '—'}{f.banco ? ` · ${f.banco}` : ''}</td>
                <td className="px-3 py-2 text-xs">{f.numeroFactura || '—'}</td>
                <td className="px-3 py-2 text-right">{f.saldoContrato ? formatCurrency(num(f.saldoContrato)) : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setEditando(f)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-purple-700 border border-purple-300 rounded-md hover:bg-purple-50">
                    <PencilSquareIcon className="h-3.5 w-3.5" /> Ajustar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Historial */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">Historial de ajustes</div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Usuario</th>
              <th className="px-3 py-2 text-left">Contrato / cuota</th>
              <th className="px-3 py-2 text-left">Cambios</th>
              <th className="px-3 py-2 text-left">Motivo</th>
              <th className="px-3 py-2 text-right">Saldo a la fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {historial.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Aún no hay ajustes.</td></tr>
            )}
            {historial.map(a => (
              <tr key={a._id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(a._createdDate).toLocaleString('es')}</td>
                <td className="px-3 py-2 text-xs">{a.usuarioNombre || a.usuarioEmail || '—'}</td>
                <td className="px-3 py-2 text-xs">{a.contrato || '—'} · #{a.numCuota ?? 0}<div className="text-gray-400">{a.titular}</div></td>
                <td className="px-3 py-2 text-xs">
                  {Object.keys(a.despues || {}).map(c => (
                    <div key={c}><span className="text-gray-500">{ETIQUETA[c] || c}:</span> {fmtValor(c, a.antes?.[c])} → <b>{fmtValor(c, a.despues[c])}</b></div>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs max-w-xs">{a.motivo}</td>
                <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                  {a.saldoAntes === a.saldoDespues ? (a.saldoDespues ? formatCurrency(num(a.saldoDespues)) : '—')
                    : <>{formatCurrency(num(a.saldoAntes))} → <b>{formatCurrency(num(a.saldoDespues))}</b></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && tipo && (
        <AjusteModal fila={editando} tipo={tipo} onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); cargar() }} />
      )}
    </div>
  )
}

function AjusteModal({ fila, tipo, onClose, onDone }: { fila: Fila; tipo: Tipo; onClose: () => void; onDone: () => void }) {
  const inicial = {
    numCuota: String(fila.numCuota ?? ''),
    valorPagado: String(num(fila.valorPagado)),
    descuento: String(num(fila.descuento)),
    fechaPago: fila.fechaPago ? new Date(fila.fechaPago).toISOString().slice(0, 10) : '',
    medioPago: fila.medioPago || '',
    banco: fila.banco || '',
    numeroReferencia: fila.numeroReferencia || '',
    numeroFactura: fila.numeroFactura || '',
  }
  const [form, setForm] = useState(inicial)
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof inicial, v: string) => setForm(f => ({ ...f, [k]: v }))
  const campos: (keyof typeof inicial)[] = tipo === 'FACTURA'
    ? ['numeroFactura']
    : tipo === 'PAGO'
      ? ['numCuota', 'valorPagado', 'descuento', 'fechaPago', 'medioPago', 'banco', 'numeroReferencia']
      : ['valorPagado', 'descuento', 'fechaPago', 'medioPago', 'banco', 'numeroReferencia']
  // Un descuento de pocos pesos casi siempre es un dígito digitado en el campo equivocado.
  const descuentoSospechoso = form.descuento !== inicial.descuento && num(form.descuento) > 0 && num(form.descuento) < 1000
  const cambios = Object.fromEntries(campos.filter(c => form[c] !== inicial[c]).map(c => [c, form[c]]))
  const hayCambios = Object.keys(cambios).length > 0
  const medios = mediosPagoPara(fila.plataforma || '')

  const guardar = async () => {
    if (!hayCambios) { toast.error('No hay cambios'); return }
    if (motivo.trim().length < 10) { toast.error('El motivo debe tener al menos 10 caracteres'); return }
    setSaving(true)
    try {
      const r = await api.patch<{ saldoAntes: string | null; saldoDespues: string | null }>(
        `/api/postgres/recaudos/ajustes/${fila._id}`, { tipo, cambios, motivo: motivo.trim() })
      toast.success(tipo === 'FACTURA' || r.saldoAntes === r.saldoDespues
        ? 'Ajuste aplicado'
        : `Ajuste aplicado · Saldo a la fecha ${formatCurrency(num(r.saldoAntes))} → ${formatCurrency(num(r.saldoDespues))}`)
      onDone()
    } catch (e) {
      handleApiError(e, 'No se pudo aplicar el ajuste')
    } finally {
      setSaving(false)
    }
  }

  const input = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-base font-semibold text-gray-900">
            Ajustar {tipo === 'INSCRIPCION' ? 'inscripción' : tipo === 'PAGO' ? `pago · cuota #${fila.numCuota}` : 'factura'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div className="text-gray-600">{fila.titular} · {fila.contrato} · validado el {fmtFecha(fila.fechaValidacion)} por {fila.validadoPor || '—'}</div>
          {tipo === 'FACTURA' ? (
            <div>
              <label htmlFor="aj-factura" className="block text-xs font-medium text-gray-700"># Factura</label>
              <input id="aj-factura" className={input} value={form.numeroFactura} onChange={e => set('numeroFactura', e.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {tipo === 'PAGO' && (
                <div className="col-span-2">
                  <label htmlFor="aj-cuota" className="block text-xs font-medium text-gray-700"># Cuota (cuota donde se aplica el pago)</label>
                  <input id="aj-cuota" type="number" min="1" step="1" className={input} value={form.numCuota}
                    onChange={e => set('numCuota', e.target.value.replace(/[^0-9]/g, ''))} />
                  <div className="text-xs text-gray-400 mt-0.5">Corrige a qué cuota se aplicó el pago.</div>
                </div>
              )}
              <div>
                <label htmlFor="aj-valor" className="block text-xs font-medium text-gray-700">Valor pagado</label>
                <input id="aj-valor" type="number" min="0" step="any" className={input} value={form.valorPagado} onChange={e => set('valorPagado', e.target.value)} />
              </div>
              <div>
                <label htmlFor="aj-desc" className="block text-xs font-medium text-gray-700">Descuento</label>
                <input id="aj-desc" type="number" min="0" step="any" className={input} value={form.descuento} onChange={e => set('descuento', e.target.value)} />
                {descuentoSospechoso && (
                  <div className="text-xs font-medium text-amber-700 mt-0.5">
                    ¿Descuento de {formatCurrency(num(form.descuento))}? Si quería cambiar la cuota, use el campo # Cuota.
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="aj-fecha" className="block text-xs font-medium text-gray-700">Fecha de pago</label>
                <input id="aj-fecha" type="date" className={input} value={form.fechaPago} onChange={e => set('fechaPago', e.target.value)} />
              </div>
              <div>
                <label htmlFor="aj-medio" className="block text-xs font-medium text-gray-700">Medio de pago</label>
                <select id="aj-medio" className={input} value={form.medioPago} onChange={e => set('medioPago', e.target.value)}>
                  <option value="">—</option>
                  {[...new Set([form.medioPago, ...medios].filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="aj-banco" className="block text-xs font-medium text-gray-700">Banco</label>
                <input id="aj-banco" className={input} value={form.banco} onChange={e => set('banco', e.target.value)} />
              </div>
              <div>
                <label htmlFor="aj-ref" className="block text-xs font-medium text-gray-700">Referencia</label>
                <input id="aj-ref" className={input} value={form.numeroReferencia} onChange={e => set('numeroReferencia', e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <label htmlFor="aj-motivo" className="block text-xs font-medium text-gray-700">Motivo del ajuste *</label>
            <textarea id="aj-motivo" rows={3} className={input} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: el comprobante de junio es por $110.000, se había registrado $90.000" />
            <div className="text-xs text-gray-400 mt-0.5">{motivo.trim().length}/10 caracteres mínimo</div>
          </div>
          {hayCambios && (
            <div className="rounded-md bg-gray-50 border border-gray-200 p-2 text-xs">
              {Object.keys(cambios).map(c => (
                <div key={c}>{ETIQUETA[c]}: {fmtValor(c, (inicial as any)[c])} → <b>{fmtValor(c, (cambios as any)[c])}</b></div>
              ))}
              {tipo !== 'FACTURA' && <div className="mt-1 text-gray-500">Al guardar se recalcula el Saldo a la Fecha del contrato.</div>}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving || !hayCambios || motivo.trim().length < 10}
            className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Aplicar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}
