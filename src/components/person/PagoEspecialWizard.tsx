'use client'

/**
 * Pago Especial — ventana propia junto a "Registrar Pago", con dos opciones excluyentes
 * en el encabezado:
 *   · Pago titular con más de una matrícula  (este archivo, modo 'multi')
 *   · Última Penalidad en pagos              (siguiente entrega)
 *
 * Modo 'multi': se pide el ID del titular, se consultan sus contratos, se marcan los que se
 * pagan y el sistema reparte el valor entre ellos (cuota pendiente de cada uno, en el orden
 * marcado). Siempre editable; no deja guardar mientras Pagado − Repartido ≠ 0.
 * Un pago por contrato, con uno o dos recibos compartidos.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline'
import { api, handleApiError } from '@/hooks/use-api'
import { getLocalToday } from '@/lib/fecha-local'
import { ACCEPT_DOCUMENTOS } from '@/lib/documentos-adjuntos'
import { mediosPagoPara } from '@/lib/medios-pago'
import RecibosDobles, { type ReciboArchivo } from '@/components/common/RecibosDobles'

interface Props {
  isOpen: boolean
  onClose: () => void
  titular: { _id: string; numeroId?: string; plataforma?: string; primerNombre?: string; primerApellido?: string }
  onCreated: () => void
}

interface ContratoRow {
  idPeople: string
  contrato: string
  titular: string
  plataforma?: string
  estado?: string
  totalPlan: number
  valorCuota: number
  numeroCuotas: number
  cuotasPagadas: number
  saldo: number
  numCuota: number
  sugerido: number
}

interface DocAdjunto { url: string; nombre: string; tipo?: string; fechaSubida?: string }

const toNum = (v: string): number => {
  const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const fmt = (n: number) => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n || 0))
const soloDigitos = (s: string) => s.replace(/[^0-9]/g, '')

export default function PagoEspecialWizard({ isOpen, onClose, titular, onCreated }: Props) {
  const [modo, setModo] = useState<'multi' | 'penalidad' | ''>('multi')

  // ── Titular y contratos ────────────────────────────────────────────────
  const [docTitular, setDocTitular] = useState(titular.numeroId || '')
  const [contratos, setContratos] = useState<ContratoRow[] | null>(null)
  const [consultando, setConsultando] = useState(false)
  /** Contratos marcados, en el orden en que se marcaron. */
  const [orden, setOrden] = useState<string[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const [cuotas, setCuotas] = useState<Record<string, string>>({})

  // ── Pago ───────────────────────────────────────────────────────────────
  const [totalStr, setTotalStr] = useState('')
  const [totalManual, setTotalManual] = useState(false)
  const [fechaPago, setFechaPago] = useState(getLocalToday())
  const [fechaReporte, setFechaReporte] = useState(getLocalToday())
  const [medioPago, setMedioPago] = useState('')
  const [banco, setBanco] = useState('')
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [dosRecibos, setDosRecibos] = useState(false)
  const [recibos, setRecibos] = useState<(ReciboArchivo | null)[]>([null, null])
  const [docs, setDocs] = useState<DocAdjunto[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const repartido = orden.reduce((s, id) => s + toNum(valores[id] || ''), 0)
  const total = totalManual ? toNum(totalStr) : repartido
  const diferencia = Math.round(total - repartido)

  /** Reparte `tot` entre los marcados en su orden: a cada uno su valor sugerido (cuota pendiente);
   *  si sobra, lo que sobra va al último; si falta, los últimos quedan con menos o en 0. */
  const repartir = (marcados: string[], tot: number, lista: ContratoRow[]) => {
    const nuevo: Record<string, string> = {}
    let resto = Math.round(tot)
    marcados.forEach((id, i) => {
      const c = lista.find(x => x.idPeople === id)
      const sug = Math.max(0, c?.sugerido ?? 0)
      let v = Math.min(sug, resto)
      if (i === marcados.length - 1) v = resto // el último absorbe el excedente
      nuevo[id] = String(Math.max(0, v))
      resto -= v
    })
    return nuevo
  }

  const consultar = async () => {
    if (!docTitular.trim()) { toast.error('Digita el ID del titular'); return }
    setConsultando(true)
    try {
      const d = await api.get<{ contratos: ContratoRow[] }>(
        `/api/postgres/pagos-titulares/multi-contrato?numeroId=${encodeURIComponent(docTitular.trim())}`)
      setContratos(d.contratos || [])
      setOrden([]); setValores({}); setCuotas({}); setTotalStr(''); setTotalManual(false)
      if (!d.contratos?.length) toast('Ese titular no tiene contratos que admitan pagos', { icon: 'ℹ️' })
    } catch (e) {
      setContratos(null)
      handleApiError(e, 'No se pudo consultar al titular')
    } finally {
      setConsultando(false)
    }
  }

  const alternar = (c: ContratoRow) => {
    if (!contratos) return
    const ya = orden.includes(c.idPeople)
    const marcados = ya ? orden.filter(x => x !== c.idPeople) : [...orden, c.idPeople]
    setOrden(marcados)
    setCuotas(p => ({ ...p, [c.idPeople]: p[c.idPeople] ?? String(c.numCuota) }))
    if (totalManual) {
      setValores(repartir(marcados, toNum(totalStr), contratos))
    } else {
      const nv: Record<string, string> = {}
      marcados.forEach(id => { nv[id] = valores[id] ?? String(contratos.find(x => x.idPeople === id)?.sugerido ?? 0) })
      setValores(nv)
    }
  }

  const cambiarTotal = (v: string) => {
    const limpio = soloDigitos(v)
    setTotalStr(limpio)
    if (limpio === '') { setTotalManual(false); return }
    setTotalManual(true)
    if (contratos && orden.length) setValores(repartir(orden, toNum(limpio), contratos))
  }

  const subirComprobantes = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.multiple = true; input.accept = ACCEPT_DOCUMENTOS; input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || [])
      document.body.removeChild(input)
      setSubiendo(true)
      for (const file of files) {
        try {
          const fd = new FormData(); fd.append('file', file)
          const res = await fetch(`/api/contracts/${titular._id}/upload-url`, { method: 'POST', body: fd })
          if (!res.ok) { const e = await res.json().catch(() => ({} as any)); throw new Error(e.details || e.error || `Error ${res.status}`) }
          const { publicUrl } = await res.json()
          setDocs(d => [...d, { url: publicUrl, nombre: file.name, tipo: file.type, fechaSubida: new Date().toISOString() }])
        } catch (e: any) {
          toast.error(`Error subiendo ${file.name}: ${e?.message || ''}`)
        }
      }
      setSubiendo(false)
    })
    input.click()
  }

  const guardar = async () => {
    if (orden.length < 1) { toast.error('Marca al menos un contrato'); return }
    if (total <= 0) { toast.error('Digita el valor total del pago'); return }
    if (diferencia !== 0) { toast.error('El reparto no coincide con el total pagado'); return }
    if (orden.some(id => toNum(valores[id] || '') <= 0)) { toast.error('Cada contrato marcado debe tener un valor mayor a 0'); return }
    if (dosRecibos && (!recibos[0] || !recibos[1])) { toast.error('Adjunta el recibo 1 y el recibo 2'); return }
    if (!fechaPago) { toast.error('Fecha de pago es requerida'); return }

    setGuardando(true)
    try {
      await api.post('/api/postgres/pagos-titulares/multi-contrato', {
        numeroId: docTitular.trim(),
        valorTotal: Math.round(total),
        fechaPago, fechaReporte: fechaReporte || null,
        medioPago: medioPago || null, banco: banco.trim() || null, numeroReferencia: referencia || null,
        nota: nota.trim() || null,
        dosRecibos,
        documentosAdjuntos: [
          ...docs,
          ...(dosRecibos
            ? recibos.flatMap((r, i) => r ? [{ url: r.url, nombre: `Recibo ${i + 1} · ${r.nombre}`, tipo: r.tipo,
                fechaSubida: r.fechaSubida, recibo: i + 1, montoLeido: r.montoLeido ?? null }] : [])
            : []),
        ],
        items: orden.map(id => ({ idPeople: id, numCuota: Number(cuotas[id]), valorPagado: toNum(valores[id] || '') })),
      })
      toast.success(`Pago registrado en ${orden.length} contrato(s)`)
      onCreated()
      onClose()
    } catch (e) {
      handleApiError(e, 'Error al registrar el pago')
    } finally {
      setGuardando(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Encabezado: título + las dos opciones excluyentes */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">⭐ Pago Especial</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Titular: {titular.primerNombre} {titular.primerApellido} · ID {titular.numeroId || '—'}
              </p>
            </div>
            <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={modo === 'multi'} onChange={e => setModo(e.target.checked ? 'multi' : '')}
                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
              <span className="text-sm font-semibold text-purple-800">Pago Titular con más de una matrícula</span>
            </label>
            <label className="inline-flex items-center gap-2 opacity-50 cursor-not-allowed" title="Disponible en la siguiente entrega">
              <input type="checkbox" disabled checked={false} className="h-4 w-4 rounded border-gray-300" />
              <span className="text-sm font-semibold text-orange-800">Última Penalidad en pagos <em className="font-normal">(próximamente)</em></span>
            </label>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {modo === '' && (
            <p className="text-sm text-gray-500 italic text-center py-8">Elige una opción en el encabezado.</p>
          )}

          {modo === 'multi' && (
            <>
              {/* 1. ID del titular + consulta */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <label htmlFor="pe-doc" className="block text-sm font-medium text-gray-700">ID del titular</label>
                <div className="mt-1 flex gap-2">
                  <input id="pe-doc" type="text" value={docTitular}
                    onChange={e => setDocTitular(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') consultar() }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Documento del titular" />
                  <button type="button" onClick={consultar} disabled={consultando}
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50">
                    {consultando ? 'Consultando…' : 'Consultar'}
                  </button>
                </div>
              </div>

              {/* 2. Contratos del titular */}
              {contratos && (
                contratos.length === 0 ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    Ese titular no tiene contratos que admitan pagos (o no están en tu alcance).
                  </p>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Contratos de {contratos[0].titular} — marca los que se pagan ({contratos.length})
                    </p>
                    <div className="space-y-2">
                      {contratos.map(c => {
                        const on = orden.includes(c.idPeople)
                        return (
                          <div key={c.idPeople} className={`rounded-lg border p-3 ${on ? 'border-purple-300 bg-purple-50/50' : 'border-gray-200'}`}>
                            <div className="flex flex-wrap items-center gap-3">
                              <label className="inline-flex items-center gap-2 cursor-pointer min-w-[220px]">
                                <input type="checkbox" checked={on} onChange={() => alternar(c)}
                                  className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
                                <span className="text-sm font-semibold text-gray-900">{c.contrato}</span>
                                {on && <span className="text-xs text-purple-700">#{orden.indexOf(c.idPeople) + 1}</span>}
                              </label>
                              <span className="text-xs text-gray-600">Saldo {fmt(c.saldo)}</span>
                              <span className="text-xs text-gray-600">Cuota {fmt(c.valorCuota)}</span>
                              <span className="text-xs text-gray-600">Pagadas {c.cuotasPagadas}/{c.numeroCuotas}</span>
                              {c.estado && <span className="text-xs text-gray-500">{c.estado}</span>}
                            </div>
                            {on && (
                              <div className="mt-2 grid grid-cols-2 gap-3 max-w-md">
                                <div>
                                  <label className="block text-xs font-medium text-gray-600"># Cuota</label>
                                  <input type="text" inputMode="numeric" value={cuotas[c.idPeople] ?? ''}
                                    onChange={e => setCuotas(p => ({ ...p, [c.idPeople]: soloDigitos(e.target.value) }))}
                                    className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm text-center font-semibold" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-600">Valor a aplicar a este contrato</label>
                                  <div className="relative mt-1">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                                    <input type="text" inputMode="numeric"
                                      value={valores[c.idPeople] ? new Intl.NumberFormat('es-CO').format(toNum(valores[c.idPeople])) : ''}
                                      onChange={e => setValores(p => ({ ...p, [c.idPeople]: soloDigitos(e.target.value) }))}
                                      className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-md text-sm" placeholder="0" />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              )}

              {/* 3. Recibos: uno o dos */}
              {orden.length > 0 && (
                <>
                  <div className={`rounded-lg border p-3 space-y-3 ${dosRecibos ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 bg-gray-50'}`}>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none">
                      <input type="checkbox" checked={dosRecibos}
                        onChange={() => { setDosRecibos(v => !v); setRecibos([null, null]) }}
                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                      El pago tiene dos recibos
                    </label>
                    {dosRecibos && (
                      <RecibosDobles carpetaId={titular._id} recibos={recibos} onChange={setRecibos} />
                    )}
                  </div>

                  {/* 4. Total y reparto */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Total pagado</label>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                        <input type="text" inputMode="numeric"
                          value={totalManual ? (totalStr ? new Intl.NumberFormat('es-CO').format(toNum(totalStr)) : '') : (repartido ? new Intl.NumberFormat('es-CO').format(repartido) : '')}
                          onChange={e => cambiarTotal(e.target.value)}
                          className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="0" />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Digítalo (p. ej. la suma de los dos recibos) y el sistema lo reparte; si no, suma los valores de cada contrato.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Repartido</label>
                      <div className="mt-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm font-semibold text-amber-900">{fmt(repartido)}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Diferencia</label>
                      <div className={`mt-1 px-3 py-2 border rounded-md text-sm font-semibold ${diferencia === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-300 text-red-800'}`}>
                        {fmt(diferencia)} {diferencia === 0 ? '✓' : diferencia > 0 ? '(falta repartir)' : '(se repartió de más)'}
                      </div>
                    </div>
                  </div>

                  {/* 5. Datos del pago */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Fecha de Pago <span className="text-red-500">*</span></label>
                      <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Fecha de Reporte</label>
                      <input type="date" value={fechaReporte} onChange={e => setFechaReporte(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Medio de Pago</label>
                      <select value={medioPago} onChange={e => setMedioPago(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                        <option value="">Seleccione</option>
                        {mediosPagoPara(titular.plataforma).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Banco</label>
                      <input type="text" value={banco} maxLength={80} onChange={e => setBanco(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Banco de origen" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700"># Referencia</label>
                      <input type="text" value={referencia}
                        onChange={e => setReferencia(e.target.value.replace(/[^A-Za-z0-9\-]/g, ''))}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Alfanumérico (igual para todos los contratos)" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Nota</label>
                      <input type="text" value={nota} maxLength={300} onChange={e => setNota(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Opcional; el sistema ya deja el detalle del reparto" />
                    </div>
                  </div>

                  {/* 6. Comprobantes */}
                  {!dosRecibos && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700">Comprobante(s)</label>
                        <button type="button" onClick={subirComprobantes} disabled={subiendo}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50">
                          <ArrowUpTrayIcon className="h-3.5 w-3.5" /> {subiendo ? 'Subiendo…' : 'Adjuntar'}
                        </button>
                      </div>
                      {docs.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Sin documentos adjuntos</p>
                      ) : (
                        <ul className="space-y-1">
                          {docs.map((d, i) => (
                            <li key={i} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-xs">
                              <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate flex-1 mr-2">{d.nombre}</a>
                              <button type="button" title="Quitar" onClick={() => setDocs(x => x.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-3 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={guardando}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-white disabled:opacity-50">Cancelar</button>
          {modo === 'multi' && (
            <button type="button" onClick={guardar}
              disabled={guardando || subiendo || orden.length === 0 || diferencia !== 0 || total <= 0}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50">
              {guardando ? 'Guardando…' : `Registrar pago en ${orden.length || ''} contrato(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
