'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ComercialPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import SinCupoModal, { type SinCupoDetalle } from '@/components/comercial/SinCupoModal'

const fmtFecha = (v: any) => { if (!v) return '—'; try { return new Date(v).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return String(v).slice(0, 10) } }

export default function GestionContratoPage() {
  const emptyF = { asesor: '', lider: '', contrato: '', numeroId: '', estado: '', startDate: '', endDate: '' }
  const [f, setF] = useState(emptyF)
  const [applied, setApplied] = useState(emptyF)
  const [rows, setRows] = useState<any[]>([])
  const [asesores, setAsesores] = useState<string[]>([])
  const [lideres, setLideres] = useState<string[]>([])
  const [estados, setEstados] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmar, setConfirmar] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  // Contrato rechazado por falta de cupo: el modal pregunta qué hacer.
  const [sinCupo, setSinCupo] = useState<{ row: any; detalle: SinCupoDetalle } | null>(null)
  const { hasPermission } = usePermissions()
  // Baja masiva: casillas + modal con motivo obligatorio.
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [bajaOpen, setBajaOpen] = useState(false)
  const [bajaMotivo, setBajaMotivo] = useState('')
  const [bajaConfirm, setBajaConfirm] = useState(false)
  const [bajaResultado, setBajaResultado] = useState<any>(null)
  const puedeSobrecupo = hasPermission(ComercialPermission.GESTION_CONTRATO_SOBRECUPO)
  const puedeDarBaja = hasPermission(ComercialPermission.GESTION_CONTRATO_DAR_BAJA)

  const fetchData = useCallback(async (fl: typeof emptyF) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(fl).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const res = await fetch(`/api/postgres/comercial/gestion-contrato?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setRows(res.rows || []); setAsesores(res.asesores || []); setEstados(res.estados || []); setLideres(res.lideres || [])
    } catch (e: any) { toast.error(e?.message || 'Error al cargar') } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchData(applied) }, [applied, fetchData])
  const hayFiltro = Object.values(applied).some(Boolean)

  /**
   * "Dejar listo" toma el cupo del salón de cada beneficiario. Si alguno ya no
   * cabe, el servidor responde sin escribir nada y con el detalle: ahí abrimos
   * el modal para cambiar de horario o autorizar el sobrecupo, que reenvía por
   * esta misma función (y el servidor vuelve a verificar el cupo).
   */
  const dejarListo = async (r: any, extra: { cambios?: any[]; sobrecupo?: boolean } = {}) => {
    setSaving(true)
    try {
      const res = await fetch('/api/postgres/comercial/gestion-contrato', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r._id, ...extra }),
      }).then(x => x.json())

      if (res?.detail?.tipo === 'sin_cupo') {
        setConfirmar(null)
        setSinCupo({ row: r, detalle: res.detail })
        return
      }
      if (res.error) throw new Error(res.error)

      toast.success(res.message || `Contrato ${r.contrato || ''} marcado como listo`)
      setRows(prev => prev.filter(x => x._id !== r._id))
      setConfirmar(null); setSinCupo(null)
    } catch (e: any) { toast.error(e?.message || 'Error') } finally { setSaving(false) }
  }

  const toggleMarca = (id: string) => setMarcados(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })
  const marcarTodos = (on: boolean) => setMarcados(on ? new Set(rows.map(r => r._id)) : new Set())

  /** Da de baja (BORRA) los contratos marcados. El servidor revalida cada uno. */
  const darDeBaja = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/postgres/comercial/gestion-contrato/baja', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(marcados), motivo: bajaMotivo }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)

      setBajaResultado(res)
      const okIds = new Set(res.resultados.filter((r: any) => r.status === 'ok').map((r: any) => r.contrato))
      setRows(prev => prev.filter(x => !okIds.has(x.contrato)))
      setMarcados(new Set())
      setBajaOpen(false); setBajaMotivo(''); setBajaConfirm(false)
      toast.success(res.message)
    } catch (e: any) { toast.error(e?.message || 'Error') } finally { setSaving(false) }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.GESTION_CONTRATO} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Gestión Contrato</h1>
          <p className="text-gray-500 mb-4 text-sm">Contratos <strong>firmados sin aprobar</strong>. Adjunta la documentación y marca <strong>Dejar listo</strong> cuando el contrato esté completo para aprobación.</p>

          <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Asesor</label>
              <select value={f.asesor} onChange={e => setF({ ...f, asesor: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[150px]">
                <option value="">Todos</option>
                {asesores.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Líder</label>
              <select value={f.lider} onChange={e => setF({ ...f, lider: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[150px]">
                <option value="">Todos</option>
                {lideres.map((l) => <option key={l} value={l}>{l}</option>)}
                <option value="(Sin líder)">(Sin líder)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase"># Contrato</label>
              <input value={f.contrato} onChange={e => setF({ ...f, contrato: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') setApplied({ ...f }) }}
                placeholder="Ej. 01-M5-…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[120px]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase"># ID</label>
              <input value={f.numeroId} onChange={e => setF({ ...f, numeroId: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') setApplied({ ...f }) }}
                placeholder="Documento" className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[110px]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Estado</label>
              <select value={f.estado} onChange={e => setF({ ...f, estado: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[120px]">
                <option value="">Todos</option>
                {estados.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Desde</label>
              <input type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Hasta</label>
              <input type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex-1" />
            <button onClick={() => setApplied({ ...f })} className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-medium hover:bg-purple-800">Aplicar</button>
            {hayFiltro && <button onClick={() => { setF(emptyF); setApplied(emptyF) }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Limpiar</button>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <span className="text-sm text-gray-500">{loading ? 'Cargando…' : `${rows.length} contrato(s) firmados sin aprobar`}</span>
            {puedeDarBaja && marcados.size > 0 && (
              <button onClick={() => setBajaOpen(true)}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
                Dar de baja ({marcados.size})
              </button>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="text-left">
                    {puedeDarBaja && (
                      <th className="px-3 py-3 border-b-2 border-gray-200 w-10">
                        <input type="checkbox" aria-label="Marcar todos"
                          checked={rows.length > 0 && marcados.size === rows.length}
                          onChange={e => marcarTodos(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                      </th>
                    )}
                    <th className="text-xs font-semibold text-gray-600 uppercase px-4 py-3 border-b-2 border-gray-200">Titular</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Contrato</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Fecha</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Estado</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={puedeDarBaja ? 6 : 5} className="text-center text-sm text-gray-400 py-10">Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={puedeDarBaja ? 6 : 5} className="text-center text-sm text-gray-400 py-10">No hay contratos firmados sin aprobar pendientes de gestión.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r._id} className={`hover:bg-purple-50/40 ${marcados.has(r._id) ? 'bg-red-50/60' : ''}`}>
                      {puedeDarBaja && (
                        <td className="px-3 py-3 border-b border-gray-100">
                          <input type="checkbox" checked={marcados.has(r._id)} onChange={() => toggleMarca(r._id)}
                            aria-label={`Marcar ${r.contrato || r.nombre}`}
                            className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                        </td>
                      )}
                      <td className="px-4 py-3 border-b border-gray-100">
                        <div className="flex flex-col"><b className="text-[13.5px] text-gray-900">{r.nombre || '(sin nombre)'}</b>
                          {/* Asesor y líder van etiquetados: son dos nombres de
                              persona seguidos y sin la etiqueta no se distinguen. */}
                          <span className="text-[11.5px] text-gray-500">
                            ID {r.numeroId} · {r.plataforma || ''}
                            {r.asesor ? <> · Asesor <b className="font-medium text-gray-700">{r.asesor}</b></> : null}
                            {r.liderComercial ? <> · Líder <b className="font-medium text-gray-700">{r.liderComercial}</b></> : null}
                            {r.extemporanea ? ' · ⏰ Extemporánea' : ''}
                          </span></div>
                      </td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm font-medium text-gray-700">{r.contrato || '—'}</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-600">{fmtFecha(r.fecha)}</td>
                      <td className="px-3 py-3 border-b border-gray-100">
                        <span className="inline-flex text-xs font-semibold rounded-full px-2.5 py-0.5 bg-amber-100 text-amber-700">{r.aprobacion || r.estado || 'Pendiente'}</span>
                      </td>
                      <td className="px-3 py-3 border-b border-gray-100">
                        <div className="flex items-center justify-end gap-2">
                          {/* Etiqueta corta: el botón ocupaba casi el doble que
                              "Dejar listo" y la fila quedaba desbalanceada. */}
                          <a href={`/person/${r._id}?soloGeneral=1`} target="_blank" rel="noopener noreferrer"
                            title="Adicionar documentos"
                            className="px-2.5 py-1.5 rounded-lg border border-purple-300 text-purple-700 text-xs font-medium hover:bg-purple-50 whitespace-nowrap">📎 Documentos</a>
                          <button onClick={() => setConfirmar(r)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">✓ Dejar listo</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {confirmar && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmar(null)}>
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Dejar listo</h3>
                <p className="text-sm text-gray-600">Marcarás el contrato <strong>{confirmar.contrato}</strong> de <strong>{confirmar.nombre}</strong> como gestionado (documentación completa). Saldrá de esta lista.</p>
                <p className="mt-3 text-sm text-gray-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  Al confirmar se <strong>toma el cupo</strong> del salón de cada beneficiario. Hasta ahora su curso era provisional.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={() => setConfirmar(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
                  <button onClick={() => dejarListo(confirmar)} disabled={saving} className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Confirmar'}</button>
                </div>
              </div>
            </div>
          )}

          {sinCupo && (
            <SinCupoModal
              detalle={sinCupo.detalle}
              contrato={sinCupo.row.contrato}
              titular={sinCupo.row.nombre}
              saving={saving}
              puedeSobrecupo={puedeSobrecupo}
              onCancel={() => setSinCupo(null)}
              onCambiarHorario={cambios => dejarListo(sinCupo.row, { cambios })}
              onSobrecupo={() => dejarListo(sinCupo.row, { sobrecupo: true })}
            />
          )}

          {/* Dar de baja = BORRAR. Se pide motivo y confirmación explícita, y el
              servidor vuelve a comprobar que ninguno esté aprobado ni listo. */}
          {bajaOpen && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setBajaOpen(false)}>
              <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Dar de baja {marcados.size} contrato(s)</h3>
                <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                  Se <strong>borran</strong> el contrato y todos sus registros: titular, beneficiarios,
                  registro académico, clases agendadas, financiero, pagos y accesos.
                  <div className="mt-2 text-xs">
                    No se puede deshacer desde aquí, pero queda una copia completa en la auditoría
                    por si hubiera que reconstruirlo.
                  </div>
                </div>

                <ul className="mt-3 max-h-40 overflow-y-auto text-sm text-gray-700 border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {rows.filter(r => marcados.has(r._id)).map(r => (
                    <li key={r._id} className="px-3 py-2">
                      <b>{r.contrato || '(sin número)'}</b> — {r.nombre}
                    </li>
                  ))}
                </ul>

                <label htmlFor="baja-motivo" className="block text-sm font-medium text-gray-700 mt-4 mb-1">Motivo *</label>
                <textarea id="baja-motivo" rows={3} value={bajaMotivo} onChange={e => setBajaMotivo(e.target.value)}
                  placeholder="Por qué se dan de baja estos contratos"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />

                <label className="flex items-start gap-2 mt-3 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={bajaConfirm} onChange={e => setBajaConfirm(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
                  Confirmo que quiero borrar estos contratos y todos sus registros.
                </label>

                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={() => { setBajaOpen(false); setBajaConfirm(false) }}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
                  <button onClick={darDeBaja} disabled={saving || !bajaConfirm || !bajaMotivo.trim()}
                    className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {saving ? 'Borrando…' : `Dar de baja (${marcados.size})`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {bajaResultado && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setBajaResultado(null)}>
              <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Resultado</h3>
                <p className="text-sm text-gray-600 mb-3">{bajaResultado.message}</p>
                <ul className="text-sm border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {bajaResultado.resultados.map((r: any, i: number) => (
                    <li key={i} className="px-3 py-2">
                      <span className={r.status === 'ok' ? 'text-emerald-700' : 'text-red-700'}>
                        {r.status === 'ok' ? '✓' : '✗'} <b>{r.contrato}</b>
                      </span>
                      {r.status === 'ok'
                        ? <span className="text-gray-500"> — {r.borrados.people} persona(s), {r.borrados.bookings} clase(s), {r.borrados.usuariosRoles} acceso(s)</span>
                        : <span className="text-gray-600"> — {r.error}</span>}
                      {r.conservados?.length > 0 && (
                        <div className="mt-1 text-xs text-amber-700">
                          Se conservaron por estar en otro contrato: {r.conservados.map((c: any) => `${c.nombre} (${c.otrosContratos.join(', ')})`).join(' · ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex justify-end">
                  <button onClick={() => setBajaResultado(null)}
                    className="px-5 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-900">Cerrar</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
