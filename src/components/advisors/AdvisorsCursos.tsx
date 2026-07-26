'use client'

import { useEffect, useMemo, useState } from 'react'

interface Advisor {
  _id: string
  nombreCompleto?: string
  primerNombre?: string
  primerApellido?: string
}
interface Props { advisors: Advisor[] }

interface CursoRow {
  campaign: string
  tipoCurso: string
  horarioCurso: string
  salon: string | null
  guia: string | null
  inicioCurso: string | null
  finalCurso: string | null
  finalCampaign: string | null
  numeroUsuarios: number
  usuInscritos: number
}

const hoy = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
const d10 = (s: any) => (s ? String(s).slice(0, 10) : '')

/** Estado por fechas (mismo criterio que Consulta de Cursos). */
function estadoCurso(r: CursoRow): { label: string; cls: string } {
  const t = hoy()
  const fc = d10(r.finalCurso), fcamp = d10(r.finalCampaign)
  if (fc && fc < t) return { label: 'Cerrado', cls: 'bg-gray-100 text-gray-600' }
  if (fcamp && fcamp >= t) return { label: 'En matrícula', cls: 'bg-blue-100 text-blue-700' }
  return { label: 'Activo', cls: 'bg-green-100 text-green-700' }
}

export default function AdvisorsCursos({ advisors }: Props) {
  const [rows, setRows] = useState<CursoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setRows((d.rows || d.data?.rows || []) as CursoRow[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const nombreDe = useMemo(() => {
    const m = new Map<string, string>()
    advisors.forEach(a => m.set(a._id, a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim() || a._id))
    return m
  }, [advisors])

  // Agrupar cursos por guía (solo activos con guía asignada).
  const grupos = useMemo(() => {
    const byGuia = new Map<string, CursoRow[]>()
    for (const r of rows) {
      const g = r.guia || '__sin__'
      if (!byGuia.has(g)) byGuia.set(g, [])
      byGuia.get(g)!.push(r)
    }
    const arr = Array.from(byGuia.entries()).map(([guia, cursos]) => ({
      guia,
      nombre: guia === '__sin__' ? 'Sin guía asignado' : (nombreDe.get(guia) || guia),
      cursos: cursos.sort((a, b) => (a.campaign + a.tipoCurso).localeCompare(b.campaign + b.tipoCurso)),
    }))
    // guías con nombre primero, "sin guía" al final; orden alfabético
    arr.sort((a, b) => (a.guia === '__sin__' ? 1 : 0) - (b.guia === '__sin__' ? 1 : 0) || a.nombre.localeCompare(b.nombre))
    return arr
  }, [rows, nombreDe])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return grupos
    return grupos.filter(g => g.nombre.toLowerCase().includes(t) || g.cursos.some(c => c.tipoCurso.toLowerCase().includes(t) || c.campaign.toLowerCase().includes(t)))
  }, [grupos, q])

  if (loading) return <div className="py-12 text-center text-gray-500">Cargando cursos asignados…</div>

  const totalCursos = grupos.reduce((n, g) => n + (g.guia === '__sin__' ? 0 : g.cursos.length), 0)
  const guiasConCurso = grupos.filter(g => g.guia !== '__sin__').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por guía, curso o campaña…"
            className="w-full pl-3 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
        </div>
        <p className="text-sm text-gray-500">{guiasConCurso} guía(s) con cursos · {totalCursos} curso(s) asignado(s)</p>
      </div>

      {filtrados.length === 0 && <p className="text-sm text-gray-400">No hay resultados.</p>}

      <div className="space-y-3">
        {filtrados.map(g => (
          <div key={g.guia} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <h3 className={`text-sm font-semibold ${g.guia === '__sin__' ? 'text-gray-500 italic' : 'text-gray-900'}`}>{g.nombre}</h3>
              <span className="text-xs text-gray-500">{g.cursos.length} curso(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100 text-xs">
                    <th className="py-2 px-4">Campaña</th><th className="px-4">Curso</th><th className="px-4">Salón</th>
                    <th className="px-4">Horario</th><th className="px-4">Cupos</th><th className="px-4">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {g.cursos.map((c, i) => {
                    const est = estadoCurso(c)
                    const lleno = c.usuInscritos >= c.numeroUsuarios && c.numeroUsuarios > 0
                    return (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 px-4">{c.campaign}</td>
                        <td className="px-4 font-medium text-gray-900">{c.tipoCurso}</td>
                        <td className="px-4">{c.salon || '—'}</td>
                        <td className="px-4">{c.horarioCurso}</td>
                        <td className="px-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${lleno ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                            {c.usuInscritos}/{c.numeroUsuarios}
                          </span>
                        </td>
                        <td className="px-4"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${est.cls}`}>{est.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
