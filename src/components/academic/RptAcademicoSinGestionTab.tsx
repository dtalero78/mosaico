'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { exportToExcel } from '@/lib/export-excel'

/**
 * Pestaña "Reporte Académico" de la pantalla Sesiones sin gestión: salones que
 * tuvieron clase pero NO cerraron su informe semanal.
 *
 * Vive como pestaña porque es la misma tarea del coordinador —revisar qué quedó
 * sin gestionar—, pero **trae sus propios filtros** en vez de compartir los de
 * la pantalla, y eso no es duplicación: la unidad aquí es el **(salón, semana)**
 * y no el evento, así que el rango natural es la SEMANA PASADA, no ayer. Con el
 * rango de ayer se estaría mirando la semana en curso, que el guía todavía tiene
 * abierta hasta el domingo: saldrían decenas de falsas alarmas.
 *
 * Se distingue "sin empezar" de "borrador" porque no son el mismo problema: en
 * uno el guía no entró, en el otro entró y dejó el cierre a medias.
 */

interface Item {
  cursoCampaignId: string
  guia: string | null
  guiaNombre: string | null
  campaign: string | null
  curso: string | null
  salon: string | null
  semanaInicio: string
  sesiones: number
  ultimaClase: string | null
  alumnos: number
  notasGuardadas: number
  ultimaEdicion: string | null
  estado: 'SIN_EMPEZAR' | 'BORRADOR'
}

const PAD = (n: number) => String(n).padStart(2, '0')
const ymdLocal = (d: Date) => `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`

/** Lunes y domingo de la semana ANTERIOR a hoy, en la TZ del navegador. */
function semanaPasada(): { desde: string; hasta: string } {
  const hoy = new Date()
  const alLunes = (hoy.getDay() + 6) % 7            // 0 = lunes
  const lunesEsta = new Date(hoy); lunesEsta.setDate(hoy.getDate() - alLunes)
  const lunes = new Date(lunesEsta); lunes.setDate(lunesEsta.getDate() - 7)
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6)
  return { desde: ymdLocal(lunes), hasta: ymdLocal(domingo) }
}

const fmtSemana = (iso: string) => {
  try {
    const l = new Date(iso + 'T12:00:00Z')
    const d = new Date(l.getTime() + 6 * 86400000)
    const f = (x: Date) => x.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    return `${f(l)} – ${f(d)}`
  } catch { return iso }
}

/** Semanas completas transcurridas desde que terminó esa semana. */
function diasDesdeCierreSemana(semanaInicio: string): number {
  try {
    const finSemana = new Date(semanaInicio + 'T12:00:00Z').getTime() + 7 * 86400000
    return Math.max(0, Math.floor((Date.now() - finSemana) / 86400000))
  } catch { return 0 }
}

export default function RptAcademicoSinGestionTab({ onCount }: { onCount?: (n: number) => void }) {
  const inicial = useMemo(() => semanaPasada(), [])
  const [startDate, setStartDate] = useState(inicial.desde)
  const [endDate, setEndDate] = useState(inicial.hasta)
  const [advisorId, setAdvisorId] = useState('')
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')

  const [items, setItems] = useState<Item[]>([])
  const [opts, setOpts] = useState<{ guias: any[]; campaigns: string[]; cursos: string[] }>(
    { guias: [], campaigns: [], cursos: [] }
  )
  const [loading, setLoading] = useState(false)
  const [resumen, setResumen] = useState({ total: 0, sinEmpezar: 0, guiasInvolucrados: 0 })

  const buscar = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      if (advisorId) qs.set('advisorId', advisorId)
      if (campaign) qs.set('campaign', campaign)
      if (curso) qs.set('curso', curso)
      const j = await fetch(`/api/postgres/reports/academico/rpt-academico-sin-gestion?${qs}`,
        { cache: 'no-store' }).then(r => r.json())
      if (!j?.success) throw new Error(j?.error || 'Error al cargar')
      setItems(j.rows || [])
      setResumen({ total: j.total || 0, sinEmpezar: j.sinEmpezar || 0, guiasInvolucrados: j.guiasInvolucrados || 0 })
      onCount?.(j.total || 0)
      // Los desplegables se arman con lo que HAY en el resultado, así no se
      // ofrece una opción que devolvería la lista vacía. Sólo se rellenan
      // cuando no hay filtro puesto, para no perder las demás opciones.
      setOpts(prev => ({
        guias: (!advisorId && j.guias?.length) ? j.guias : prev.guias,
        campaigns: (!campaign && j.campaigns?.length) ? j.campaigns : prev.campaigns,
        cursos: (!curso && j.cursos?.length) ? j.cursos : prev.cursos,
      }))
      if (j.truncado) toast('Hay más resultados de los que caben: acota el rango.', { icon: '⚠️' })
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally { setLoading(false) }
  }

  useEffect(() => { buscar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const limpiar = () => {
    const s = semanaPasada()
    setStartDate(s.desde); setEndDate(s.hasta)
    setAdvisorId(''); setCampaign(''); setCurso('')
  }

  const exportar = () => exportToExcel(
    items,
    [
      { header: 'Guía', accessor: r => r.guiaNombre || '(sin guía)' },
      { header: 'Campaña', accessor: r => r.campaign || '' },
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Semana', accessor: r => fmtSemana(r.semanaInicio) },
      { header: 'Semana inicio', accessor: r => r.semanaInicio },
      { header: 'Sesiones', accessor: r => r.sesiones },
      { header: 'Alumnos', accessor: r => r.alumnos },
      { header: 'Estado', accessor: r => (r.estado === 'SIN_EMPEZAR' ? 'Sin empezar' : 'Borrador') },
      { header: 'Valoraciones guardadas', accessor: r => r.notasGuardadas },
      { header: 'Días desde el cierre de la semana', accessor: r => diasDesdeCierreSemana(r.semanaInicio) },
    ],
    'rpt-academico-sin-gestion'
  )

  /** Abre el informe de ESE salón y ESA semana, ya filtrado. */
  const irAlInforme = (r: Item) => {
    const qs = new URLSearchParams()
    if (r.guia) qs.set('guia', r.guia)
    if (r.curso) qs.set('curso', r.curso)
    if (r.salon) qs.set('salon', r.salon)
    if (r.campaign) qs.set('campaign', r.campaign)
    qs.set('startDate', r.semanaInicio)
    qs.set('endDate', r.semanaInicio)
    window.open(`/dashboard/academic/reporte-academico?${qs}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-4">
      {/* Filtros — propios de esta pestaña (rango semanal, no diario) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="rpt-desde" className="text-xs font-medium text-gray-500">Desde</label>
            <input id="rpt-desde" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rpt-hasta" className="text-xs font-medium text-gray-500">Hasta</label>
            <input id="rpt-hasta" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rpt-guia" className="text-xs font-medium text-gray-500">Guía</label>
            <select id="rpt-guia" value={advisorId} onChange={e => setAdvisorId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
              <option value="">Todos</option>
              {opts.guias.map((g: any) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rpt-campania" className="text-xs font-medium text-gray-500">Campaña</label>
            <select id="rpt-campania" value={campaign} onChange={e => setCampaign(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[170px]">
              <option value="">Todas</option>
              {opts.campaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Donde la pestaña de sesiones tiene "Tipo" (SESSION/CLUB) aquí va
              Curso: el informe no distingue tipos de evento, pero sí de curso. */}
          <div className="flex flex-col gap-1">
            <label htmlFor="rpt-curso" className="text-xs font-medium text-gray-500">Curso</label>
            <select id="rpt-curso" value={curso} onChange={e => setCurso(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[140px]">
              <option value="">Todos</option>
              {opts.cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={buscar} disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Buscar
          </button>
          <button type="button" onClick={limpiar} title="Volver a la semana pasada"
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-500 text-sm hover:bg-gray-50">⟲</button>
          <button type="button" onClick={exportar} disabled={!items.length}
            className="px-4 py-2 rounded-lg bg-green-100 text-green-800 text-sm font-medium hover:bg-green-200 disabled:opacity-40">
            Exportar CSV
          </button>
        </div>
      </div>

      {/* KPIs — mismo tamaño que los de la pestaña de sesiones */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Total sin gestionar</p>
          <p className="text-xl font-bold text-amber-900">{resumen.total.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500">salón · semana</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Sin empezar</p>
          <p className="text-xl font-bold text-red-900">{resumen.sinEmpezar.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500">el guía no entró</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Guías involucrados</p>
          <p className="text-xl font-bold text-indigo-900">{resumen.guiasInvolucrados.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Rango</p>
          <p className="text-xl font-bold text-gray-900 truncate" title={`${startDate} → ${endDate}`}>{fmtSemana(startDate)}</p>
          <p className="text-[10px] text-gray-500 truncate">{startDate} → {endDate}</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Guía', 'Campaña · Curso · Salón', 'Semana', 'Sesiones', 'Alumnos', 'Estado', 'Hace', 'Ir'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Cargando…</td></tr>
              )}
              {!loading && !items.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center">
                  <span className="inline-block rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-800 text-sm font-medium">
                    Todos los informes de ese rango están cerrados.
                  </span>
                </td></tr>
              )}
              {!loading && items.map(r => {
                const dias = diasDesdeCierreSemana(r.semanaInicio)
                return (
                  <tr key={`${r.cursoCampaignId}-${r.semanaInicio}`}
                    className={r.estado === 'SIN_EMPEZAR' ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserCircleIcon className="h-7 w-7 text-gray-300 shrink-0" />
                        <span className={`font-medium ${r.guiaNombre ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                          {r.guiaNombre || '(sin guía)'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{r.campaign || '—'} · {r.curso || '—'} · Salón {r.salon || '—'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-gray-900">{fmtSemana(r.semanaInicio)}</div>
                      <div className="text-xs text-gray-500">{r.semanaInicio}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{r.sesiones}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{r.alumnos}</td>
                    <td className="px-4 py-3">
                      {r.estado === 'SIN_EMPEZAR' ? (
                        <span className="inline-block rounded-full bg-red-100 text-red-700 px-2.5 py-0.5 text-xs font-semibold">Sin empezar</span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold"
                          title={`${r.notasGuardadas} valoración(es) guardada(s), sin cerrar`}>
                          Borrador · {r.notasGuardadas}
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap text-xs ${dias > 7 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      {dias === 0 ? 'recién' : `${dias} día${dias === 1 ? '' : 's'}`}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => irAlInforme(r)} title="Abrir el informe de este salón"
                        className="text-indigo-600 hover:text-indigo-800">
                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
