'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon, ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { InformesPermission } from '@/types/permissions'

interface CronHealth {
  lastRun: string | null; status: string | null; hoursSince: number | null; stale: boolean
  processed: number; success: number; failed: number; error: string | null
  metadata: any
}
interface PegLimpio { _id: string; nombre: string; numeroId: string; plataforma: string | null; contrato: string | null; nivel: string; stepActual: number; stepReal: number; desfase: number; totalBookings: number; causa: string }
interface PegFlag   { _id: string; nombre: string; numeroId: string; plataforma: string | null; contrato: string | null; nivel: string; stepActual: number; stepReal: number; desfase: number; totalBookings: number; clrHistoric: boolean; overridesCount: number; overrideDetails: Array<{ step: string; isCompleted: boolean }>; banderas: string }
interface ReconRow  { fecha: string; nombre: string; studentId: string; numeroId?: string; nivel?: string; stepAnterior?: number; stepNuevo?: number; status?: string; success: boolean; error?: string }

interface Data {
  cron: CronHealth
  rango: { startDate: string; endDate: string }
  snapshot: { calculatedAt: string | null; cached: boolean; totalPegados: number }
  pegadosLimpios: PegLimpio[]
  pegadosConFlags: PegFlag[]
  reconciliaciones: ReconRow[]
  totalesRango: { reconciliacionesOk: number; reconciliacionesFail: number }
}

const today    = new Date().toISOString().substring(0, 10)
const monthAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10) })()

const STATUS_BADGE: Record<string, string> = {
  success: 'bg-green-100 text-green-700', partial: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700', running: 'bg-blue-100 text-blue-700',
}

export default function ConciliacionStepsPage() {
  const [startDate, setStartDate] = useState(monthAgo)
  const [endDate, setEndDate]     = useState(today)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (sd: string, ed: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ startDate: sd, endDate: ed })
      const res = await fetch(`/api/postgres/reports/academica/conciliacion-steps?${qs}`, { cache: 'no-store' })
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
    data.pegadosLimpios.forEach(r => rows.push({
      tipo: 'Pegado LIMPIO pendiente', nombre: r.nombre, numeroId: r.numeroId, pais: r.plataforma ?? '',
      contrato: r.contrato ?? '', nivel: r.nivel, stepActual: r.stepActual, stepReal: r.stepReal,
      desfase: r.desfase, banderas: '', detalle: r.causa,
    }))
    data.pegadosConFlags.forEach(r => rows.push({
      tipo: 'Pegado CON FLAGS', nombre: r.nombre, numeroId: r.numeroId, pais: r.plataforma ?? '',
      contrato: r.contrato ?? '', nivel: r.nivel, stepActual: r.stepActual, stepReal: r.stepReal,
      desfase: r.desfase, banderas: r.banderas, detalle: 'Requiere revisión manual',
    }))
    data.reconciliaciones.forEach(r => rows.push({
      tipo: 'Reconciliación', nombre: r.nombre, numeroId: r.numeroId ?? r.studentId, pais: '',
      contrato: '', nivel: r.nivel ?? '', stepActual: r.stepAnterior ?? '', stepReal: r.stepNuevo ?? '',
      desfase: '', banderas: r.status ?? '',
      detalle: r.success ? `OK · ${r.fecha}` : `Fallido (${r.fecha}): ${r.error ?? ''}`,
    }))
    if (!rows.length) rows.push({ tipo: 'Sin datos', nombre: '', numeroId: '', pais: '', contrato: '', nivel: '', stepActual: '', stepReal: '', desfase: '', banderas: '', detalle: '' })
    exportToExcel(rows, [
      { header: 'Tipo', accessor: r => r.tipo }, { header: 'Nombre', accessor: r => r.nombre },
      { header: 'NumeroId', accessor: r => r.numeroId }, { header: 'País', accessor: r => r.pais },
      { header: 'Contrato', accessor: r => r.contrato }, { header: 'Nivel', accessor: r => r.nivel },
      { header: 'Step actual', accessor: r => r.stepActual }, { header: 'Step real', accessor: r => r.stepReal },
      { header: 'Desfase', accessor: r => r.desfase }, { header: 'Banderas', accessor: r => r.banderas },
      { header: 'Detalle/Causa', accessor: r => r.detalle },
    ], `conciliacion-steps_${startDate}_${endDate}`)
  }

  const cron = data?.cron
  const limpios = data?.pegadosLimpios ?? []
  const conFlags = data?.pegadosConFlags ?? []
  const recRows = data?.reconciliaciones ?? []

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">
        {/* Header + filtros */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <WrenchScrewdriverIcon className="h-7 w-7 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Conciliación Steps</h1>
              <p className="text-sm text-gray-500">Monitoreo del cron nocturno <code>reconcile-pegados</code> (02:00 UTC · 9 PM Colombia) y pegados pendientes.</p>
            </div>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label htmlFor="cs-start" className="block text-xs text-gray-500 mb-1">Desde</label>
              <input id="cs-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="cs-end" className="block text-xs text-gray-500 mb-1">Hasta</label>
              <input id="cs-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button type="button" onClick={handleApply} disabled={loading} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">Aplicar</button>
            <button type="button" onClick={handleClear} disabled={loading} className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Limpiar</button>
            <button type="button" onClick={() => fetchData(startDate, endDate)} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><ArrowPathIcon className="h-4 w-4" />Recargar</button>
            <PermissionGuard permission={InformesPermission.ACAD_CONCILIACION_STEPS_EXP}>
              <button type="button" onClick={handleCSV} disabled={loading || !data} className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"><ArrowDownTrayIcon className="h-4 w-4" />CSV</button>
            </PermissionGuard>
          </div>
        </div>

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}
            <button type="button" onClick={handleApply} className="ml-4 text-xs underline">Reintentar</button></div>
        )}

        {/* Salud del cron */}
        <div className={`bg-white rounded-xl border shadow-sm p-4 ${cron?.stale ? 'border-red-300' : 'border-gray-200'}`}>
          <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-gray-800">Cron reconcile-pegados</h3>
              <p className="text-[11px] text-gray-400">Diario 02:00 UTC · 9 PM Colombia · solo procesa casos limpios (sin overrides ni clrHistoric)</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[cron?.status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>{cron?.status ?? 'sin datos'}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div><p className="text-2xl font-bold text-gray-900">{cron?.processed ?? 0}</p><p className="text-[10px] text-gray-400 uppercase">Procesados</p></div>
            <div><p className="text-2xl font-bold text-green-700">{cron?.success ?? 0}</p><p className="text-[10px] text-gray-400 uppercase">Exitosos</p></div>
            <div><p className={`text-2xl font-bold ${(cron?.failed ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{cron?.failed ?? 0}</p><p className="text-[10px] text-gray-400 uppercase">Fallidos</p></div>
            <div><p className="text-2xl font-bold text-amber-700">{cron?.metadata?.omitidos ?? 0}</p><p className="text-[10px] text-gray-400 uppercase">Omitidos (próxima corrida)</p></div>
          </div>
          <p className="text-[11px] text-gray-500 mt-3">
            Última corrida: {cron?.lastRun ? `${new Date(cron.lastRun).toLocaleString()} (${cron.hoursSince}h)` : '—'}
            {cron?.metadata?.totalPegados !== undefined && (
              <span className="ml-3 text-gray-400">· Pegados detectados al correr: {cron.metadata.totalPegados} (limpios: {cron.metadata.limpios ?? 0} · con flags: {cron.metadata.conFlags ?? 0})</span>
            )}
          </p>
          {cron?.stale && <p className="text-[11px] text-red-600 font-medium mt-1">⚠ Stale: no se ejecuta hace &gt;26h — revisar cron-worker en DO</p>}
          {cron?.error && <p className="text-[11px] text-red-600 mt-1">Error: {cron.error}</p>}
        </div>

        {/* Pegados pendientes — limpios + con flags */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Limpios */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Pegados LIMPIOS pendientes</h3>
                <p className="text-[11px] text-gray-400">Sin overrides ni clrHistoric — el cron los reconciliará esta noche</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${limpios.length ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{limpios.length}</span>
            </div>
            {loading ? <div className="p-6 text-center text-sm text-gray-400">Cargando…</div>
              : limpios.length === 0 ? (
                <p className="p-6 text-center text-sm text-green-700 flex items-center justify-center gap-2"><CheckCircleIcon className="h-5 w-5" />Sin pegados limpios — el cron está al día</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0"><tr>
                      <th className="text-left px-3 py-2 font-semibold">Estudiante</th>
                      <th className="text-left px-3 py-2 font-semibold">País</th>
                      <th className="text-left px-3 py-2 font-semibold">Nivel</th>
                      <th className="text-center px-3 py-2 font-semibold">Actual</th>
                      <th className="text-center px-3 py-2 font-semibold">Real</th>
                      <th className="text-center px-3 py-2 font-semibold">Desfase</th>
                      <th className="text-left px-3 py-2 font-semibold">Causa</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {limpios.map(r => (
                        <tr key={r._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2"><a href={`/student/${r._id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{r.nombre}</a><div className="text-[10px] text-gray-400">{r.numeroId} · {r.contrato ?? ''}</div></td>
                          <td className="px-3 py-2 text-gray-600">{r.plataforma ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.nivel}</td>
                          <td className="px-3 py-2 text-center text-gray-700">{r.stepActual}</td>
                          <td className="px-3 py-2 text-center text-blue-700 font-semibold">{r.stepReal}</td>
                          <td className="px-3 py-2 text-center"><span className="text-red-600 font-semibold">+{r.desfase}</span></td>
                          <td className="px-3 py-2 text-amber-700">{r.causa}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          {/* Con flags */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Pegados CON FLAGS (requieren revisión manual)</h3>
                <p className="text-[11px] text-gray-400">Tienen overrides activos o Clear Historic — el cron NO los toca</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${conFlags.length ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{conFlags.length}</span>
            </div>
            {loading ? <div className="p-6 text-center text-sm text-gray-400">Cargando…</div>
              : conFlags.length === 0 ? (
                <p className="p-6 text-center text-sm text-green-700 flex items-center justify-center gap-2"><CheckCircleIcon className="h-5 w-5" />Sin pegados con flags</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0"><tr>
                      <th className="text-left px-3 py-2 font-semibold">Estudiante</th>
                      <th className="text-left px-3 py-2 font-semibold">Nivel</th>
                      <th className="text-center px-3 py-2 font-semibold">Actual</th>
                      <th className="text-center px-3 py-2 font-semibold">Real</th>
                      <th className="text-center px-3 py-2 font-semibold">Desfase</th>
                      <th className="text-left px-3 py-2 font-semibold">Banderas</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {conFlags.map(r => (
                        <tr key={r._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2"><a href={`/student/${r._id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{r.nombre}</a><div className="text-[10px] text-gray-400">{r.numeroId} · {r.plataforma ?? ''}</div></td>
                          <td className="px-3 py-2 text-gray-600">{r.nivel}</td>
                          <td className="px-3 py-2 text-center text-gray-700">{r.stepActual}</td>
                          <td className="px-3 py-2 text-center text-blue-700 font-semibold">{r.stepReal}</td>
                          <td className="px-3 py-2 text-center"><span className="text-red-600 font-semibold">+{r.desfase}</span></td>
                          <td className="px-3 py-2 text-orange-700">{r.banderas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>

        {/* Reconciliaciones del rango */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">Reconciliaciones realizadas por el cron</h3>
            <p className="text-xs text-gray-400 mt-0.5">{data?.totalesRango.reconciliacionesOk ?? 0} OK · {data?.totalesRango.reconciliacionesFail ?? 0} fallidas · {startDate} → {endDate}</p>
          </div>
          {loading ? <div className="p-6 text-center text-sm text-gray-400">Cargando…</div>
            : recRows.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Sin reconciliaciones en el período</p>
            : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 sticky top-0"><tr>
                    <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                    <th className="text-left px-3 py-2 font-semibold">Estudiante</th>
                    <th className="text-left px-3 py-2 font-semibold">Nivel</th>
                    <th className="text-center px-3 py-2 font-semibold">Cambio</th>
                    <th className="text-center px-3 py-2 font-semibold">Estado</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {recRows.map((r, i) => (
                      <tr key={`${r.studentId}-${i}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.fecha}</td>
                        <td className="px-3 py-2"><a href={`/student/${r.studentId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{r.nombre}</a><div className="text-[10px] text-gray-400">{r.numeroId ?? ''}</div></td>
                        <td className="px-3 py-2 text-gray-600">{r.nivel ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-700">step {r.stepAnterior ?? '?'} → <strong className="text-blue-700">{r.stepNuevo ?? '?'}</strong></td>
                        <td className="px-3 py-2 text-center">
                          {r.success
                            ? <span className="text-green-600 inline-flex items-center gap-1" title={r.status}><CheckCircleIcon className="h-4 w-4" /></span>
                            : <span className="text-red-600 inline-flex items-center gap-1" title={r.error}><ExclamationTriangleIcon className="h-4 w-4" /></span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </DashboardLayout>
  )
}
