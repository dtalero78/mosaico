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

export default function EvaluacionesPage() {
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [applied, setApplied] = useState({ curso: '', salon: '' })
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

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
          <p className="text-gray-500 mb-4 text-sm">Resultados de las evaluaciones y cuestionarios por curso: mejor nota, intentos y aprobó/no aprobó por estudiante.</p>

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
                    <tr key={i} className="hover:bg-purple-50/40">
                      <td className="px-4 py-3 border-b border-gray-100"><div className="flex flex-col"><b className="text-[13.5px] text-gray-900">{r.nombre}</b><span className="text-[11.5px] text-gray-500">ID {r.numeroId}</span></div></td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-700">{r.code}</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-700">{r.titulo}</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-center font-bold tabular-nums">{r.mejor}%</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-center tabular-nums text-gray-600">{r.intentos} / 3</td>
                      <td className="px-3 py-3 border-b border-gray-100 text-center">{badge(r.estado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
