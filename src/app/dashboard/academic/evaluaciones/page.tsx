'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'

const badge = (estado: string) => estado === 'aprobado'
  ? <span className="inline-flex text-xs font-bold rounded-full px-2.5 py-0.5 bg-emerald-100 text-emerald-700">Aprobó</span>
  : estado === 'no_aprobado'
    ? <span className="inline-flex text-xs font-bold rounded-full px-2.5 py-0.5 bg-red-100 text-red-700">No aprobó</span>
    : <span className="inline-flex text-xs font-bold rounded-full px-2.5 py-0.5 bg-amber-100 text-amber-700">En curso</span>

const fmtFechaHora = (iso: string) => {
  try { return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

export default function EvaluacionesPage() {
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [applied, setApplied] = useState({ curso: '', salon: '' })
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  // Modal del último intento (clic sobre el estudiante).
  const [detalle, setDetalle] = useState<any>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  const verDetalle = async (r: any) => {
    setCargandoDetalle(true)
    setDetalle({ cargando: true, nombre: r.nombre })
    try {
      const qs = new URLSearchParams({ academicaId: r.academicaId })
      if (r.code) qs.set('code', r.code)
      if (r.step) qs.set('step', r.step)
      if (r.cuestionarioId) qs.set('cuestionarioId', r.cuestionarioId)
      const res = await fetch(`/api/postgres/reports/academico/evaluaciones/detalle?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      setDetalle(res)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar el intento')
      setDetalle(null)
    } finally { setCargandoDetalle(false) }
  }

  const fetchData = useCallback(async (f: { curso: string; salon: string }) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (f.curso) qs.set('curso', f.curso)
      if (f.salon) qs.set('salon', f.salon)
      const res = await fetch(`/api/postgres/reports/academico/evaluaciones?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setData(res)
      if (!curso && res.cursos?.length) setCurso(res.cursos[0])
    } catch (e: any) { toast.error(e?.message || 'Error al cargar evaluaciones') } finally { setLoading(false) }
  }, [curso])

  useEffect(() => { fetchData(applied) }, [applied, fetchData])

  const rows = data?.rows || []
  const R = data?.resumen || {}

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.EVALUACIONES_VER} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Evaluaciones</h1>
          <p className="text-gray-500 mb-4 text-sm">Resultados por curso: mejor nota, intentos (hasta 3) y el resultado del <b>último intento</b> con correctas, incorrectas y porcentaje. Haz clic en un estudiante para ver su último intento pregunta por pregunta.</p>

          <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Curso</label>
              <select value={curso} onChange={e => { setCurso(e.target.value); setSalon('') }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[140px]">
                {(data?.cursos || []).length === 0 && <option value="">—</option>}
                {(data?.cursos || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Salón</label>
              <select value={salon} onChange={e => setSalon(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[120px]">
                <option value="">Todos</option>
                {(data?.salones || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex-1" />
            <button onClick={() => setApplied({ curso, salon })} className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-medium hover:bg-purple-800">Aplicar</button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Estudiantes</div><div className="text-2xl font-extrabold">{R.estudiantes ?? 0}</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Cuestionarios aprobados</div><div className="text-2xl font-extrabold text-fuchsia-600">{R.cuestionariosAprobados ?? 0} / {R.cuestionariosTotal ?? 0}</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">% aprobación</div><div className="text-2xl font-extrabold">{R.aprobacionPct ?? 0}%</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Promedio intentos</div><div className="text-2xl font-extrabold">{R.promedioIntentos ?? 0}</div></div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr className="text-left">
                    <th className="text-xs font-semibold text-gray-600 uppercase px-4 py-3 border-b-2 border-gray-200">Estudiante</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Evaluación</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Cuestionario</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200 text-center">Mejor nota</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200 text-center">Intentos</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200 text-center">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="text-center text-sm text-gray-400 py-10">Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-sm text-gray-400 py-10">Sin resultados de evaluaciones para este curso todavía.</td></tr>
                  ) : rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-purple-50/40 cursor-pointer" onClick={() => verDetalle(r)} title="Ver el último intento">
                      <td className="px-4 py-3 border-b border-gray-100">
                        <div className="flex flex-col">
                          <b className="text-[13.5px] text-purple-700 hover:text-purple-900 underline decoration-purple-200">{r.nombre}</b>
                          <span className="text-[11.5px] text-gray-500">ID {r.numeroId}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-700">{r.code}</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-700">{r.titulo}</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-center font-bold tabular-nums">{r.mejor}%</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-center tabular-nums text-gray-600">{r.intentos} / 3</td>
                      {/* Resultado = ÚLTIMO intento: correctas, incorrectas y % */}
                      <td className="px-3 py-3 border-b border-gray-100 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-2 text-[12.5px] tabular-nums">
                            <span className="font-bold text-emerald-600">{r.ultimo?.correctas ?? 0}</span>
                            <span className="text-gray-400">correctas</span>
                            <span className="font-bold text-red-600">{r.ultimo?.incorrectas ?? 0}</span>
                            <span className="text-gray-400">incorrectas</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-[13px] tabular-nums">{r.ultimo?.porcentaje ?? 0}%</span>
                            {badge(r.estado)}
                          </div>
                          <span className="text-[10.5px] text-gray-400">último intento (#{r.ultimo?.intento ?? r.intentos})</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modal: último intento del cuestionario */}
          {detalle && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setDetalle(null)}>
              <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-100">
                  <div>
                    <h3 className="font-bold text-gray-900">{detalle.estudiante?.nombre || detalle.nombre}</h3>
                    {!detalle.cargando && (
                      <p className="text-xs text-gray-500">
                        {detalle.cuestionarioTitulo} · {detalle.code} {detalle.step ? `· ${detalle.step}` : ''}
                      </p>
                    )}
                  </div>
                  <button onClick={() => setDetalle(null)} type="button" title="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
                </div>

                {detalle.cargando || cargandoDetalle ? (
                  <div className="p-10 text-center text-sm text-gray-400">Cargando el último intento…</div>
                ) : (
                  <div className="p-5">
                    {/* Resumen del último intento */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                      <div className="bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Intento</div>
                        <div className="text-xl font-extrabold">#{detalle.ultimo?.intento} <small className="text-gray-400 text-xs font-semibold">de 3</small></div>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-3">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Correctas</div>
                        <div className="text-xl font-extrabold text-emerald-700">{detalle.ultimo?.correctas}</div>
                      </div>
                      <div className="bg-red-50 rounded-xl p-3">
                        <div className="text-[10px] uppercase tracking-wide text-red-700 font-semibold">Incorrectas</div>
                        <div className="text-xl font-extrabold text-red-700">{detalle.ultimo?.incorrectas}</div>
                      </div>
                      <div className="bg-purple-50 rounded-xl p-3">
                        <div className="text-[10px] uppercase tracking-wide text-purple-700 font-semibold">Resultado</div>
                        <div className="text-xl font-extrabold text-purple-700">{detalle.ultimo?.porcentaje}%</div>
                        <div className="text-[11px] font-bold mt-0.5">{detalle.ultimo?.aprobado ? <span className="text-emerald-600">Aprobó</span> : <span className="text-red-600">No aprobó</span>}</div>
                      </div>
                    </div>
                    {detalle.ultimo?.enviadaEn && (
                      <p className="text-[11.5px] text-gray-500 mb-4">Enviado el {fmtFechaHora(detalle.ultimo.enviadaEn)}{detalle.ultimo?.duracionSeg ? ` · duró ${Math.round(detalle.ultimo.duracionSeg / 60)} min` : ''}</p>
                    )}

                    {/* Detalle pregunta por pregunta */}
                    <div className="text-[10.5px] uppercase tracking-wide text-gray-500 font-bold mb-2">Respuestas del último intento</div>
                    <ol className="space-y-2 mb-4">
                      {(detalle.ultimo?.respuestas || []).map((q: any, i: number) => (
                        <li key={i} className={`rounded-lg border p-3 ${q.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
                          <div className="flex items-start gap-2">
                            <span className={`text-xs font-bold mt-0.5 ${q.ok ? 'text-emerald-600' : 'text-red-600'}`}>{q.ok ? '✓' : '✗'}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium text-gray-900">{i + 1}. {q.question || '(sin enunciado)'}</p>
                              <p className="text-[12.5px] text-gray-700 mt-1">
                                Respondió: <b className={q.ok ? 'text-emerald-700' : 'text-red-700'}>{String(q.selected ?? '') || '— sin responder —'}</b>
                              </p>
                              {!q.ok && q.correct !== undefined && q.correct !== '' && (
                                <p className="text-[12.5px] text-gray-700">Correcta: <b className="text-emerald-700">{String(q.correct)}</b></p>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                      {(detalle.ultimo?.respuestas || []).length === 0 && (
                        <li className="text-sm text-gray-400 text-center py-4">Este intento no guardó el detalle de las respuestas.</li>
                      )}
                    </ol>

                    {/* Historial de intentos */}
                    {(detalle.historial || []).length > 1 && (
                      <>
                        <div className="text-[10.5px] uppercase tracking-wide text-gray-500 font-bold mb-2">Todos los intentos</div>
                        <div className="flex flex-wrap gap-2">
                          {detalle.historial.map((h: any, i: number) => (
                            <span key={i} className={`text-xs rounded-lg px-2.5 py-1 border ${h.aprobado ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                              #{h.intento}: {h.score}/{h.total} · {h.porcentaje}%
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
