'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'

const METRIC_COLS = [
  { key: 'asistio', label: 'Asistió', ico: '✅', grupo: 'HÁBITOS' },
  { key: 'puntual', label: 'Puntual', ico: '⏰', grupo: 'HÁBITOS' },
  { key: 'asignacion', label: 'Asignación', ico: '📋', grupo: 'HÁBITOS' },
  { key: 'dominio', label: 'Dominio', ico: '🎯', grupo: 'DESEMPEÑO' },
  { key: 'participo', label: 'Participó', ico: '🙌', grupo: 'DESEMPEÑO' },
  { key: 'desafio', label: 'Desafío', ico: '🏆', grupo: 'DESEMPEÑO' },
  { key: 'activo', label: 'Activo', ico: '⚡', grupo: 'ACTITUDES' },
  { key: 'respeto', label: 'Respeto', ico: '🤝', grupo: 'ACTITUDES' },
  { key: 'camara', label: 'Cámara', ico: '🎥', grupo: 'ACTITUDES' },
]

const fmtFecha = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('es', { day: '2-digit', month: 'short' }) } catch { return iso } }

export default function ReporteAcademicoPage() {
  const [f, setF] = useState({ guia: '', curso: '', salon: '', startDate: '', endDate: '' })
  const [applied, setApplied] = useState(f)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [genIA, setGenIA] = useState<string | null>(null)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [savingNota, setSavingNota] = useState<string | null>(null)
  const [comentIA, setComentIA] = useState<Record<string, string>>({})

  const fetchData = useCallback(async (fl: typeof f) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(fl).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const res = await fetch(`/api/postgres/reports/academico/reporte-academico?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setData(res)
      // sincroniza estados editables
      const nt: Record<string, string> = {}, ci: Record<string, string> = {}
      ;(res.rows || []).forEach((r: any) => { nt[r.academicaId] = r.notaGuia || ''; ci[r.academicaId] = r.comentarioIA || '' })
      setNotas(nt); setComentIA(ci)
      // refleja filtros resueltos por el server
      setF(prev => ({ ...prev, guia: res.guias?.length === 1 ? res.guias[0].id : prev.guia, curso: res.curso || prev.curso, salon: res.salon || prev.salon }))
    } catch (e: any) { toast.error(e?.message || 'Error al cargar el reporte') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(applied) }, [applied, fetchData])

  const aplicar = () => setApplied({ ...f })
  const semanaActual = () => { const n = { ...f, startDate: '', endDate: '' }; setF(n); setApplied(n) }

  const generarIA = async (r: any) => {
    setGenIA(r.academicaId)
    try {
      const res = await fetch('/api/postgres/reports/academico/reporte-academico/comentario-ia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaId: r.academicaId, numeroId: r.numeroId, salon: data.salon, curso: data.curso,
          semanaInicio: data.semanaInicio, nombre: r.nombre, sesSemana: r.sesSemana, metricas: r.metricas,
          asistenciaCursoPct: r.asistenciaCursoPct, progresoPct: r.progresoPct, comentariosSemana: r.comentariosSemana,
        }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      setComentIA(prev => ({ ...prev, [r.academicaId]: res.comentarioIA }))
      toast.success('Comentario IA generado')
    } catch (e: any) { toast.error(e?.message || 'Error al generar comentario') } finally { setGenIA(null) }
  }

  const guardarNota = async (r: any) => {
    setSavingNota(r.academicaId)
    try {
      const res = await fetch('/api/postgres/reports/academico/reporte-academico', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicaId: r.academicaId, numeroId: r.numeroId, salon: data.salon, curso: data.curso, semanaInicio: data.semanaInicio, notaGuia: notas[r.academicaId] || '' }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success('Valoración guardada')
    } catch (e: any) { toast.error(e?.message || 'Error al guardar') } finally { setSavingNota(null) }
  }

  const rows = data?.rows || []
  const R = data?.resumen || {}

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.REPORTE_ACADEMICO_VER} showDefaultMessage>
        <style>{`
          .oval{display:inline-block;width:26px;height:17px;border-radius:99px;vertical-align:middle;border:2px solid transparent}
          .oval.full{background:linear-gradient(120deg,#6d28d9,#c026d3);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
          .oval.half{background:linear-gradient(90deg,#6d28d9 0 50%,transparent 50% 100%);border-color:#c026d3}
          .oval.empty{background:transparent;border-color:#dc2626}
          .oval.none{background:transparent;border:2px dashed #c9c2d6}
          @media print{
            nav,aside,.no-print,button{display:none !important}
            .print-header{display:flex !important}
            body{background:#fff}
            @page{size:landscape;margin:10mm}
            tr{page-break-inside:avoid}
            thead{display:table-header-group}
          }
          @media screen{.print-header{display:none}}
        `}</style>

        <div className="p-6 max-w-7xl mx-auto">
          {/* Print header */}
          <div className="print-header items-center justify-between border-b-2 border-purple-700 pb-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl grid place-items-center text-white font-extrabold" style={{ background: 'conic-gradient(from 210deg,#f59e0b,#c026d3,#6d28d9,#f59e0b)' }}>M</div>
              <div><div className="text-sm font-bold tracking-wide text-purple-800">MOSAICO · + que Matemáticas</div><div className="text-xs text-gray-500">Reporte Académico</div></div>
            </div>
            <div className="text-right text-sm">
              <div className="font-bold">{data ? `${fmtFecha(data.semanaInicio)} – ${fmtFecha(new Date(new Date(data.semanaFin + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10))}` : ''}</div>
              <div className="text-xs text-gray-500">{data?.curso} · Salón {data?.salon} · Guía: {data?.guiaNombre}</div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-1 no-print">
            <h1 className="text-2xl font-bold text-gray-900">Reporte Académico</h1>
            <button onClick={() => window.print()} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">🖨 Imprimir / PDF</button>
          </div>
          <p className="text-gray-500 mb-4 text-sm no-print">Consolidado semanal de métricas por salón. Óvalo por métrica según las sesiones de la semana. El Guía ve solo sus cursos.</p>

          {/* Filtros */}
          <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Guía</label>
              <select value={f.guia} onChange={e => setF({ ...f, guia: e.target.value })} disabled={(data?.guias?.length || 0) <= 1}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[170px] disabled:bg-gray-100">
                {(data?.guias?.length || 0) !== 1 && <option value="">Todas</option>}
                {(data?.guias || []).map((g: any) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Curso</label>
              <select value={f.curso} onChange={e => setF({ ...f, curso: e.target.value, salon: '' })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[120px]">
                {(data?.cursos || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Salón</label>
              <select value={f.salon} onChange={e => setF({ ...f, salon: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[110px]">
                {(data?.salones || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
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
            <button onClick={aplicar} className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-medium hover:bg-purple-800">Aplicar</button>
            <button onClick={semanaActual} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Semana actual</button>
          </div>

          {/* Resumen */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Estudiantes</div><div className="text-2xl font-extrabold">{R.estudiantes ?? 0}</div><div className="text-xs text-gray-500">del salón</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Asistencia semana</div><div className="text-2xl font-extrabold text-fuchsia-600">{R.asistidasSemana ?? 0} / {R.totalSesSemana ?? 0}</div><div className="text-xs text-gray-500">{R.asistenciaSemanaPct ?? 0}%</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Asistencia del curso</div><div className="text-2xl font-extrabold">{R.asistenciaCursoPct ?? 0}%</div><div className="text-xs text-gray-500">acumulada</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Progreso del curso</div><div className="text-2xl font-extrabold">{R.progresoPct ?? 0}%</div><div className="text-xs text-gray-500">promedio del salón</div></div>
          </div>

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-6">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-sm">Métricas de la semana</h3>
              <span className="text-xs text-gray-500">Óvalo por métrica según las sesiones de la semana</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky left-0 bg-white text-left text-xs font-semibold text-gray-600 px-4 pb-3 pt-2 align-bottom border-b border-gray-200 min-w-[160px]">Estudiante</th>
                    <th colSpan={3} className="text-[10px] uppercase tracking-wide text-purple-700 font-bold text-center pt-2 pb-1 border-b border-gray-100">Hábitos</th>
                    <th colSpan={3} className="text-[10px] uppercase tracking-wide text-fuchsia-600 font-bold text-center pt-2 pb-1 border-b border-gray-100">Desempeño</th>
                    <th colSpan={3} className="text-[10px] uppercase tracking-wide text-cyan-700 font-bold text-center pt-2 pb-1 border-b border-gray-100">Actitudes</th>
                    <th rowSpan={2} className="text-xs font-semibold text-gray-600 text-center px-2 pb-3 pt-2 align-bottom border-b border-gray-200">Sesiones</th>
                  </tr>
                  <tr>
                    {METRIC_COLS.map(m => (
                      <th key={m.key} title={m.label} className="text-[11px] text-gray-500 font-medium text-center px-1 pb-3 border-b-2 border-gray-200" style={{ width: 46 }}>
                        <span className="block text-[15px] mb-0.5">{m.ico}</span>{m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} className="text-center text-sm text-gray-400 py-10">Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={11} className="text-center text-sm text-gray-400 py-10">{data?.sinCurso ? 'Selecciona curso y salón.' : 'Sin estudiantes en este salón / semana.'}</td></tr>
                  ) : rows.map((r: any) => (
                    <tr key={r.academicaId} className="hover:bg-purple-50/40">
                      <td className="sticky left-0 bg-white px-4 py-3 border-b border-gray-100">
                        <div className="flex flex-col"><b className="text-[13.5px] text-gray-900">{r.nombre}</b><span className="text-[11.5px] text-gray-500">ID {r.numeroId} · {r.plataforma}</span></div>
                      </td>
                      {METRIC_COLS.map(m => (
                        <td key={m.key} className="text-center py-3 border-b border-gray-100"><span className={`oval ${r.metricas[m.key]?.estado || 'none'}`} title={`${r.metricas[m.key]?.cumplidas || 0}/${r.sesSemana}`}></span></td>
                      ))}
                      <td className="text-center py-3 border-b border-gray-100"><span className={`font-extrabold text-[15px] ${r.sesSemana === 0 ? 'text-red-600' : ''}`}>{r.sesSemana}<small className="text-gray-500 font-semibold text-[11px]">/{r.sesSemana || 2}</small></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 items-center text-xs text-gray-500 px-4 py-3">
              <span className="inline-flex items-center gap-2"><span className="oval full"></span> Cumplió todas</span>
              <span className="inline-flex items-center gap-2"><span className="oval half"></span> Cumplió algunas</span>
              <span className="inline-flex items-center gap-2"><span className="oval empty"></span> No cumplió</span>
              <span className="inline-flex items-center gap-2"><span className="oval none"></span> Sin sesión</span>
            </div>
          </div>

          {/* Comentario IA + Valoración del Guía */}
          {rows.length > 0 && (
            <>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-bold mb-2">Comentario IA + Valoración del Guía</div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
                {rows.map((r: any) => (
                  <div key={r.academicaId} className="grid grid-cols-1 md:grid-cols-[170px_1fr_1fr]">
                    <div className="px-4 py-3 border-r border-gray-100"><div className="flex flex-col"><b className="text-[13.5px]">{r.nombre}</b><span className="text-[11.5px] text-gray-500">{r.sesSemana} sesión(es) · {r.asistenciaCursoPct}% curso</span></div></div>
                    <div className="px-4 py-3 border-r border-gray-100">
                      <div className="flex items-center gap-2 mb-1"><span className="text-[10.5px] uppercase tracking-wide text-gray-500 font-semibold">Comentario</span><span className="text-[9.5px] bg-fuchsia-50 text-fuchsia-600 rounded-full px-2 py-0.5 font-bold">✦ IA</span></div>
                      <p className="text-[13px] text-gray-800 whitespace-pre-wrap min-h-[20px]">{comentIA[r.academicaId] || <span className="text-gray-400">— sin generar —</span>}</p>
                      <button onClick={() => generarIA(r)} disabled={genIA === r.academicaId} className="no-print mt-1.5 text-xs font-semibold text-purple-700 hover:text-purple-900 disabled:opacity-50">
                        {genIA === r.academicaId ? 'Generando…' : (comentIA[r.academicaId] ? '✦ Regenerar' : '✦ Generar con IA')}
                      </button>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[10.5px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Valoración del Guía</div>
                      <textarea value={notas[r.academicaId] ?? ''} onChange={e => setNotas(p => ({ ...p, [r.academicaId]: e.target.value }))}
                        placeholder="Escribe tu valoración de la semana…" className="w-full min-h-[64px] resize-y border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
                      <button onClick={() => guardarNota(r)} disabled={savingNota === r.academicaId} className="no-print mt-1.5 text-xs font-semibold text-purple-700 hover:text-purple-900 disabled:opacity-50">
                        {savingNota === r.academicaId ? 'Guardando…' : 'Guardar valoración'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
