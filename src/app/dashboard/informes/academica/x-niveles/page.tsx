'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowDownTrayIcon, AcademicCapIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'

interface Row { nombre: string; id: string; correo: string | null; nivel: string; step: string | null }
interface Data {
  rows: Row[]; total: number; capped: boolean; maxRows: number
  porNivel: { nivel: string; n: number }[]
  meta: { niveles: string[]; stepsDisponibles: string[]; nivel: string; step: string; startDate: string; endDate: string }
}

export default function XNivelesPage() {
  const [nivel, setNivel]         = useState('')
  const [step, setStep]           = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [data, setData]   = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (nv: string, st: string, sd: string, ed: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams()
      if (nv) qs.set('nivel', nv)
      if (st) qs.set('step', st)
      if (sd) qs.set('startDate', sd)
      if (ed) qs.set('endDate', ed)
      const res = await fetch(`/api/postgres/reports/academica/x-niveles?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error al cargar datos')
      setData(json)
    } catch (e: any) { setError(e.message || 'Error inesperado') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData('', '', '', '') }, [fetchData])

  // Cambiar nivel reinicia el step y recarga (así el dropdown de steps se
  // repuebla y el conteo/chips quedan siempre en sync con lo mostrado).
  const onNivelChange = (v: string) => { setNivel(v); setStep(''); fetchData(v, '', startDate, endDate) }
  const onStepChange  = (v: string) => { setStep(v); fetchData(nivel, v, startDate, endDate) }
  const pickNivel     = (v: string) => { setNivel(v); setStep(''); fetchData(v, '', startDate, endDate) }
  const handleApply   = () => fetchData(nivel, step, startDate, endDate)
  const handleClear   = () => { setNivel(''); setStep(''); setStartDate(''); setEndDate(''); fetchData('', '', '', '') }

  const handleCSV = () => {
    if (!data?.rows.length) return
    exportToExcel(data.rows, [
      { header: 'Nombre', accessor: r => r.nombre },
      { header: 'ID',     accessor: r => r.id },
      { header: 'Correo', accessor: r => r.correo ?? '' },
      { header: 'Nivel',  accessor: r => r.nivel },
      { header: 'Step',   accessor: r => r.step ?? '' },
    ], `x-niveles${nivel ? '_' + nivel : '_todos'}${step ? '_' + step.replace(/\s+/g, '') : ''}${startDate ? '_' + startDate : ''}`)
  }

  const appliedNivel = data?.meta?.nivel ?? ''
  const stepsDisponibles = data?.meta?.stepsDisponibles ?? []

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">
        {/* Header */}
        <div className="flex items-center gap-3">
          <AcademicCapIcon className="h-7 w-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">X Niveles</h1>
            <p className="text-sm text-gray-500">Usuarios académicos por nivel (BN1…DONE o todos), con conteo y exportación.</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="xn-nivel" className="block text-xs text-gray-500 mb-1">Nivel</label>
              <select id="xn-nivel" value={nivel} onChange={e => onNivelChange(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]">
                <option value="">Todos</option>
                {(data?.meta?.niveles ?? []).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="xn-step" className="block text-xs text-gray-500 mb-1">Step</label>
              <select id="xn-step" value={step} onChange={e => onStepChange(e.target.value)} disabled={!nivel || !stepsDisponibles.length}
                title={!nivel ? 'Selecciona un nivel para filtrar por step' : 'Filtrar por step'}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[130px] disabled:bg-gray-100 disabled:text-gray-400">
                <option value="">Todos</option>
                {stepsDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="xn-start" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
              <input id="xn-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="xn-end" className="block text-xs text-gray-500 mb-1">Fecha final</label>
              <input id="xn-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 ml-auto flex-wrap">
              <button type="button" onClick={handleApply} disabled={loading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">Aplicar filtro</button>
              <button type="button" onClick={handleClear} disabled={loading}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Limpiar</button>
              <button type="button" onClick={handleCSV} disabled={loading || !data?.rows.length}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                <ArrowDownTrayIcon className="h-4 w-4" /> Descargar CSV
              </button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">El filtro de fecha aplica sobre la fecha de contrato del registro académico. Vacío = todos.</p>
        </div>

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}
            <button type="button" onClick={handleApply} className="ml-4 text-xs underline">Reintentar</button></div>
        )}

        {/* Conteo + desglose por nivel */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Total usuarios</p>
            <p className="text-3xl font-bold text-gray-900">{(data?.total ?? 0).toLocaleString()}</p>
            <p className="text-[11px] text-gray-400">{appliedNivel || 'Todos los niveles'}{data?.meta?.step ? ` · ${data.meta.step}` : ''}</p>
          </div>
          {/* Chips por nivel */}
          <div className="flex flex-wrap gap-1.5 flex-1">
            {(data?.porNivel ?? []).map(p => (
              <button key={p.nivel} type="button"
                onClick={() => pickNivel(p.nivel)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${appliedNivel === p.nivel ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {p.nivel} <span className="font-semibold">{p.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Detalle</h3>
            <p className="text-xs text-gray-400">
              {(data?.rows.length ?? 0).toLocaleString()} filas
              {data?.capped && <span className="text-amber-600"> · mostrando {data.maxRows.toLocaleString()} de {data.total.toLocaleString()} (afina filtros o usa CSV)</span>}
            </p>
          </div>
          {loading ? (
            <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" /><p className="text-sm text-gray-400">Cargando…</p></div>
          ) : !data?.rows.length ? (
            <p className="p-8 text-center text-sm text-gray-400">Sin usuarios para los filtros seleccionados.</p>
          ) : (
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    {['#', 'Nombre', 'ID', 'Correo', 'Nivel', 'Step'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r, i) => (
                    <tr key={`${r.id}-${i}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.nombre || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.id}</td>
                      <td className="px-3 py-2 text-gray-600">{r.correo ?? '—'}</td>
                      <td className="px-3 py-2"><span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">{r.nivel}</span></td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.step ?? '—'}</td>
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
