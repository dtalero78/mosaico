'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ComercialPermission } from '@/types/permissions'

const fmtFecha = (v: any) => { if (!v) return '—'; try { return new Date(v).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return String(v).slice(0, 10) } }

export default function GestionContratoPage() {
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmar, setConfirmar] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async (s: string) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams(); if (s) qs.set('search', s)
      const res = await fetch(`/api/postgres/comercial/gestion-contrato?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setRows(res.rows || [])
    } catch (e: any) { toast.error(e?.message || 'Error al cargar') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(applied) }, [applied, fetchData])

  const dejarListo = async (r: any) => {
    setSaving(true)
    try {
      const res = await fetch('/api/postgres/comercial/gestion-contrato', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r._id }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Contrato ${r.contrato || ''} marcado como listo`)
      setRows(prev => prev.filter(x => x._id !== r._id))
      setConfirmar(null)
    } catch (e: any) { toast.error(e?.message || 'Error') } finally { setSaving(false) }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.GESTION_CONTRATO} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Gestión Contrato</h1>
          <p className="text-gray-500 mb-4 text-sm">Contratos <strong>firmados sin aprobar</strong>. Adjunta la documentación y marca <strong>Dejar listo</strong> cuando el contrato esté completo para aprobación.</p>

          <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <label className="text-xs font-medium text-gray-500 uppercase">Buscar</label>
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setApplied(search) }}
                placeholder="Nombre, ID o número de contrato…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={() => setApplied(search)} className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-medium hover:bg-purple-800">Buscar</button>
            {applied && <button onClick={() => { setSearch(''); setApplied('') }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Limpiar</button>}
          </div>

          <div className="text-sm text-gray-500 mb-2">{loading ? 'Cargando…' : `${rows.length} contrato(s) firmados sin aprobar`}</div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="text-left">
                    <th className="text-xs font-semibold text-gray-600 uppercase px-4 py-3 border-b-2 border-gray-200">Titular</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Contrato</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Fecha</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Estado</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="text-center text-sm text-gray-400 py-10">Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-sm text-gray-400 py-10">No hay contratos firmados sin aprobar pendientes de gestión.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r._id} className="hover:bg-purple-50/40">
                      <td className="px-4 py-3 border-b border-gray-100">
                        <div className="flex flex-col"><b className="text-[13.5px] text-gray-900">{r.nombre || '(sin nombre)'}</b>
                          <span className="text-[11.5px] text-gray-500">ID {r.numeroId} · {r.plataforma || ''}{r.extemporanea ? ' · ⏰ Extemporánea' : ''}</span></div>
                      </td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm font-medium text-gray-700">{r.contrato || '—'}</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-600">{fmtFecha(r.fecha)}</td>
                      <td className="px-3 py-3 border-b border-gray-100">
                        <span className="inline-flex text-xs font-semibold rounded-full px-2.5 py-0.5 bg-amber-100 text-amber-700">{r.aprobacion || r.estado || 'Pendiente'}</span>
                      </td>
                      <td className="px-3 py-3 border-b border-gray-100">
                        <div className="flex items-center justify-end gap-2">
                          <a href={`/person/${r._id}?soloGeneral=1`} target="_blank" rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700 text-xs font-medium hover:bg-purple-50">📎 Adicionar documentos</a>
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
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={() => setConfirmar(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
                  <button onClick={() => dejarListo(confirmar)} disabled={saving} className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Confirmar'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
