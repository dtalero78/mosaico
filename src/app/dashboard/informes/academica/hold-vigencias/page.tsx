'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon, ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { InformesPermission } from '@/types/permissions'

interface CronHealth {
  lastRun: string | null; status: string | null; hoursSince: number | null
  stale: boolean; processed: number; success: number; failed: number; error: string | null
}
interface HoldRow { _id: string; nombre: string; numeroId: string; plataforma: string | null; fechaOnHold: string | null; fechaFinOnHold: string | null; diasVencido: number; causa: string }
interface VigRow  { _id: string; nombre: string; numeroId: string; plataforma: string | null; contrato: string | null; finalContrato: string | null; diasVencido: number; causa: string }
interface AccionRow { fecha: string; nombre: string; studentId: string; success: boolean; error?: string; diasExtendidos?: number; finalContrato?: string }

interface Data {
  crons: { reactivate: CronHealth; expire: CronHealth }
  rango: { startDate: string; endDate: string }
  desbloqueos: AccionRow[]; bloqueos: AccionRow[]
  totalesRango: { desbloqueosOk: number; desbloqueosFail: number; bloqueosOk: number; bloqueosFail: number }
  inconsistencias: { holdPendientes: HoldRow[]; vigenciaPendientes: VigRow[] }
}

const today       = new Date().toISOString().substring(0, 10)
const monthAgo    = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10) })()

const STATUS_BADGE: Record<string, string> = {
  success: 'bg-green-100 text-green-700', partial: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700', running: 'bg-blue-100 text-blue-700',
}

function CronCard({ title, schedule, h }: { title: string; schedule: string; h: CronHealth }) {
  return (
    <div className={`bg-white rounded-xl border shadow-sm p-4 ${h.stale ? 'border-red-300' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <p className="text-[11px] text-gray-400">{schedule}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[h.status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
          {h.status ?? 'sin datos'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-2">
        <div><p className="text-lg font-bold text-gray-900">{h.processed}</p><p className="text-[10px] text-gray-400 uppercase">Procesados</p></div>
        <div><p className="text-lg font-bold text-green-700">{h.success}</p><p className="text-[10px] text-gray-400 uppercase">Exitosos</p></div>
        <div><p className={`text-lg font-bold ${h.failed > 0 ? 'text-red-600' : 'text-gray-400'}`}>{h.failed}</p><p className="text-[10px] text-gray-400 uppercase">Fallidos</p></div>
      </div>
      <p className="text-[11px] text-gray-500">
        Última corrida: {h.lastRun ? `${new Date(h.lastRun).toLocaleString()} (${h.hoursSince}h)` : '—'}
      </p>
      {h.stale && <p className="text-[11px] text-red-600 font-medium mt-1">⚠ Stale: no se ejecuta hace &gt;26h — revisar cron-worker</p>}
      {h.error && <p className="text-[11px] text-red-600 mt-1">Error: {h.error}</p>}
    </div>
  )
}

export default function HoldVigenciasPage() {
  const [startDate, setStartDate] = useState(monthAgo)
  const [endDate, setEndDate]     = useState(today)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (sd: string, ed: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ startDate: sd, endDate: ed })
      const res = await fetch(`/api/postgres/reports/academica/hold-vigencias?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error al cargar datos')
      setData(json)
    } catch (e: any) { setError(e.message || 'Error inesperado') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(monthAgo, today) }, [fetchData])

  const handleApply = () => fetchData(startDate, endDate)
  const handleClear = () => { setStartDate(monthAgo); setEndDate(today); fetchData(monthAgo, today) }

  const handleCSV = () => {
    if (!data) return
    const rows: any[] = []
    data.inconsistencias.holdPendientes.forEach(r => rows.push({ tipo: 'Inconsistencia OnHold', nombre: r.nombre, numeroId: r.numeroId, pais: r.plataforma ?? '', fecha: r.fechaFinOnHold ?? '', dias: r.diasVencido, detalle: r.causa }))
    data.inconsistencias.vigenciaPendientes.forEach(r => rows.push({ tipo: 'Inconsistencia Vigencia', nombre: r.nombre, numeroId: r.numeroId, pais: r.plataforma ?? '', fecha: r.finalContrato ?? '', dias: r.diasVencido, detalle: r.causa }))
    data.desbloqueos.forEach(r => rows.push({ tipo: 'Desbloqueo', nombre: r.nombre, numeroId: r.studentId, pais: '', fecha: r.fecha, dias: r.diasExtendidos ?? '', detalle: r.success ? 'OK' : `Fallido: ${r.error}` }))
    data.bloqueos.forEach(r => rows.push({ tipo: 'Bloqueo', nombre: r.nombre, numeroId: r.studentId, pais: '', fecha: r.fecha, dias: '', detalle: r.success ? 'OK' : `Fallido: ${r.error}` }))
    if (!rows.length) { rows.push({ tipo: 'Sin datos', nombre: '', numeroId: '', pais: '', fecha: '', dias: '', detalle: '' }) }
    exportToExcel(rows, [
      { header: 'Tipo', accessor: r => r.tipo }, { header: 'Nombre', accessor: r => r.nombre },
      { header: 'NumeroId/ID', accessor: r => r.numeroId }, { header: 'País', accessor: r => r.pais },
      { header: 'Fecha', accessor: r => r.fecha }, { header: 'Días', accessor: r => r.dias },
      { header: 'Detalle/Causa', accessor: r => r.detalle },
    ], `hold-vigencias_${startDate}_${endDate}`)
  }

  const holdInc = data?.inconsistencias.holdPendientes ?? []
  const vigInc  = data?.inconsistencias.vigenciaPendientes ?? []
  const t = data?.totalesRango
  const emptyHealth: CronHealth = { lastRun: null, status: null, hoursSince: null, stale: true, processed: 0, success: 0, failed: 0, error: null }

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Hold &amp; Vigencias</h1>
            <p className="text-sm text-gray-500">Monitoreo del cron: desbloqueos por OnHold vencido, bloqueos por contrato vencido e inconsistencias.</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label htmlFor="hv-start" className="block text-xs text-gray-500 mb-1">Desde</label>
              <input id="hv-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="hv-end" className="block text-xs text-gray-500 mb-1">Hasta</label>
              <input id="hv-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button type="button" onClick={handleApply} disabled={loading}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">Aplicar</button>
            <button type="button" onClick={handleClear} disabled={loading}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Limpiar</button>
            <button type="button" onClick={() => fetchData(startDate, endDate)}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><ArrowPathIcon className="h-4 w-4" />Recargar</button>
            <PermissionGuard permission={InformesPermission.ACAD_HOLD_VIGENCIAS_EXP}>
              <button type="button" onClick={handleCSV} disabled={loading || !data}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"><ArrowDownTrayIcon className="h-4 w-4" />CSV</button>
            </PermissionGuard>
          </div>
        </div>

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}
            <button type="button" onClick={handleApply} className="ml-4 text-xs underline">Reintentar</button></div>
        )}

        {/* Salud de los crons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <CronCard title="Desbloqueo OnHold (reactivate-onhold)" schedule="Diario 03:00 UTC · 10 PM Colombia" h={data?.crons.reactivate ?? emptyHealth} />
          <CronCard title="Bloqueo por Vigencia (expire-contracts)" schedule="Diario 04:00 UTC · 11 PM Colombia" h={data?.crons.expire ?? emptyHealth} />
        </div>

        {/* Inconsistencias (lo importante) */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Hold no desbloqueados */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">OnHold vencido NO desbloqueado</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${holdInc.length ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{holdInc.length}</span>
            </div>
            {loading ? <div className="p-6 text-center text-sm text-gray-400">Cargando…</div>
              : holdInc.length === 0 ? (
                <p className="p-6 text-center text-sm text-green-700 flex items-center justify-center gap-2"><CheckCircleIcon className="h-5 w-5" />Sin inconsistencias — todos desbloqueados</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500"><tr>
                      <th className="text-left px-3 py-2 font-semibold">Estudiante</th><th className="text-left px-3 py-2 font-semibold">Fin OnHold</th>
                      <th className="text-center px-3 py-2 font-semibold">Vencido</th><th className="text-left px-3 py-2 font-semibold">Causa</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {holdInc.map(r => (
                        <tr key={r._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2"><a href={`/student/${r._id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{r.nombre}</a><div className="text-[10px] text-gray-400">{r.numeroId} · {r.plataforma}</div></td>
                          <td className="px-3 py-2 text-gray-600">{r.fechaFinOnHold}</td>
                          <td className="px-3 py-2 text-center"><span className="text-red-600 font-semibold">{r.diasVencido}d</span></td>
                          <td className="px-3 py-2 text-amber-700">{r.causa}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          {/* Vigencias no bloqueadas */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Contrato vencido NO bloqueado</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${vigInc.length ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{vigInc.length}</span>
            </div>
            {loading ? <div className="p-6 text-center text-sm text-gray-400">Cargando…</div>
              : vigInc.length === 0 ? (
                <p className="p-6 text-center text-sm text-green-700 flex items-center justify-center gap-2"><CheckCircleIcon className="h-5 w-5" />Sin inconsistencias — todos bloqueados</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500"><tr>
                      <th className="text-left px-3 py-2 font-semibold">Estudiante</th><th className="text-left px-3 py-2 font-semibold">Fin Contrato</th>
                      <th className="text-center px-3 py-2 font-semibold">Vencido</th><th className="text-left px-3 py-2 font-semibold">Causa</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {vigInc.map(r => (
                        <tr key={r._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2"><a href={`/student/${r._id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{r.nombre}</a><div className="text-[10px] text-gray-400">{r.numeroId} · {r.contrato ?? ''} · {r.plataforma}</div></td>
                          <td className="px-3 py-2 text-gray-600">{r.finalContrato}</td>
                          <td className="px-3 py-2 text-center"><span className="text-red-600 font-semibold">{r.diasVencido}d</span></td>
                          <td className="px-3 py-2 text-amber-700">{r.causa}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>

        {/* Acciones recientes del cron (rango) */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <AccionTable title="Desbloqueos (OnHold) realizados" subtitle={`${t?.desbloqueosOk ?? 0} OK · ${t?.desbloqueosFail ?? 0} fallidos · ${startDate} → ${endDate}`} rows={data?.desbloqueos ?? []} loading={loading} extraCol="diasExtendidos" extraLabel="Días ext." />
          <AccionTable title="Bloqueos (Vigencia) realizados" subtitle={`${t?.bloqueosOk ?? 0} OK · ${t?.bloqueosFail ?? 0} fallidos · ${startDate} → ${endDate}`} rows={data?.bloqueos ?? []} loading={loading} extraCol="finalContrato" extraLabel="Fin contrato" />
        </div>
      </div>
    </DashboardLayout>
  )
}

function AccionTable({ title, subtitle, rows, loading, extraCol, extraLabel }: {
  title: string; subtitle: string; rows: AccionRow[]; loading: boolean; extraCol: 'diasExtendidos' | 'finalContrato'; extraLabel: string
}) {
  const renderExtra = (r: AccionRow) => (r as any)[extraCol] ?? '—'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      {loading ? <div className="p-6 text-center text-sm text-gray-400">Cargando…</div>
        : rows.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Sin acciones en el período</p>
        : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 sticky top-0"><tr>
                <th className="text-left px-3 py-2 font-semibold">Fecha</th><th className="text-left px-3 py-2 font-semibold">Estudiante</th>
                <th className="text-left px-3 py-2 font-semibold">{extraLabel}</th><th className="text-center px-3 py-2 font-semibold">Estado</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={`${r.studentId}-${i}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.fecha}</td>
                    <td className="px-3 py-2"><a href={`/student/${r.studentId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{r.nombre}</a></td>
                    <td className="px-3 py-2 text-gray-600">{renderExtra(r)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.success
                        ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircleIcon className="h-4 w-4" /></span>
                        : <span className="text-red-600 inline-flex items-center gap-1" title={r.error}><ExclamationTriangleIcon className="h-4 w-4" /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
