'use client'

import { useState, useEffect, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ComercialPermission } from '@/types/permissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

export default function ConsultaCursosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.CONSULTA_CURSOS} showDefaultMessage>
        <ConsultaCursosContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function ConsultaCursosContent() {
  const [rows, setRows] = useState<any[]>([])
  const [guias, setGuias] = useState<{ _id: string; nombreCompleto: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState('')

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then(d => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => {})
      .finally(() => setLoading(false))
    fetch('/api/postgres/guias')
      .then(r => (r.ok ? r.json() : { guias: [] }))
      .then(d => setGuias(Array.isArray(d.guias) ? d.guias : []))
      .catch(() => {})
  }, [])

  const guiaNombre = (id: any) => {
    if (!id) return '—'
    const g = guias.find(x => x._id === id)
    return g ? g.nombreCompleto : String(id)
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (tipo && String(r.tipoCurso) !== tipo) return false
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      if (!String(r.campaign || '').toLowerCase().includes(s) &&
          !String(r.tipoCurso || '').toLowerCase().includes(s) &&
          !String(r.salon || '').toLowerCase().includes(s)) return false
    }
    return true
  }), [rows, q, tipo])

  const d = (v: any) => (v ? String(v).slice(0, 10) : '—')

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Consulta de Cursos</h1>
        <p className="mt-2 text-gray-600">Cursos de campaña disponibles con sus cupos y horarios (solo lectura).</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Buscar</label>
            <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Campaña, curso o salón..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} title="Tipo de curso"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500">
              <option value="">Todos</option>
              {TIPOS_CURSO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500 text-sm">No hay cursos que coincidan.</p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-sm text-gray-500 mb-2">{filtered.length} curso(s)</p>
            <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Campaña</th><th>Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio curso</th><th>Final curso</th><th>Cierre matríc.</th><th>Cupos</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any, i: number) => {
                  const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.campaign}</td>
                      <td>{r.tipoCurso}</td>
                      <td>{r.salon || '—'}</td>
                      <td>{guiaNombre(r.guia)}</td>
                      <td>{r.horarioCurso}</td>
                      <td>{d(r.inicioCurso)}</td>
                      <td>{d(r.finalCurso)}</td>
                      <td>{d(r.finalCampaign)}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${full ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
