'use client'

import { useState, useEffect } from 'react'
import { formatDateTime } from '@/lib/utils'

interface ClassHistoryProps {
  data: any
  isLoading: boolean
}

function getTypeBadgeClass(tipoEvento: string): string {
  switch (tipoEvento) {
    case 'SESSION': return 'badge-info'
    case 'CLUB': return 'badge-success'
    case 'WELCOME': return 'badge-warning'
    default: return 'badge-info'
  }
}

export default function ClassHistory({ data, isLoading }: ClassHistoryProps) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'attended' | 'not-attended' | 'cancelled'>('all')
  const [advisorFilter, setAdvisorFilter] = useState('')
  const [advisorNames, setAdvisorNames] = useState<{ [key: string]: string }>({})

  useEffect(() => {
    const loadAdvisors = async () => {
      try {
        const res = await fetch('/api/postgres/guias')
        if (!res.ok) return
        const d = await res.json()
        if (d.success && d.advisors) {
          const map: { [key: string]: string } = {}
          for (const a of d.advisors) {
            const name = a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim()
            if (a._id) map[a._id] = name || 'Sin nombre'
            if (a.email) map[a.email] = name || 'Sin nombre'
          }
          setAdvisorNames(map)
        }
      } catch { /* ignore */ }
    }
    loadAdvisors()
  }, [])

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-8 bg-gray-200 rounded w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 bg-gray-100 rounded w-full" />
        ))}
      </div>
    )
  }

  // Normalize: same logic as student.service.ts (asistio is source of truth)
  const rawHistory: any[] = data?.history || []
  const classes = rawHistory.map((c: any) => ({
    ...c,
    asistencia: c.asistio != null ? c.asistio : c.asistencia,
  }))

  const uniqueAdvisors = Array.from(new Set(classes.map((c: any) => c.advisor).filter(Boolean))) as string[]

  const filtered = classes.filter((item: any) => {
    if (startDate) {
      const d = new Date(item.fechaEvento)
      if (d < new Date(startDate)) return false
    }
    if (endDate) {
      const d = new Date(item.fechaEvento)
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      if (d > end) return false
    }
    if (attendanceFilter === 'attended' && !item.asistencia) return false
    if (attendanceFilter === 'not-attended' && item.asistencia) return false
    if (attendanceFilter === 'cancelled' && !item.cancelo) return false
    if (advisorFilter && item.advisor !== advisorFilter) return false
    return true
  })

  return (
    <div>
      {/* Filters */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Filtros</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fecha desde</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fecha hasta</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estado de asistencia</label>
            <select
              value={attendanceFilter}
              onChange={(e) => setAttendanceFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos</option>
              <option value="attended">Asistió</option>
              <option value="not-attended">No asistió</option>
              <option value="cancelled">Canceló</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Guía</label>
            <select
              value={advisorFilter}
              onChange={(e) => setAdvisorFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Todos los advisors</option>
              {uniqueAdvisors.map((id) => (
                <option key={id} value={id}>
                  {advisorNames[id] || id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => { setStartDate(''); setEndDate(''); setAttendanceFilter('all'); setAdvisorFilter('') }}
            className="text-xs text-gray-600 hover:text-gray-800 underline"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Table */}
      <style>{`
        .history-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .history-scroll::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .history-scroll::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 4px; }
        .history-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
      `}</style>
      <div className="history-scroll table-container max-h-[450px] overflow-y-auto overflow-x-auto">
        <table className="table">
          <thead className="table-header sticky top-0 z-10 bg-gray-50">
            <tr>
              <th className="table-header-cell">Fecha</th>
              <th className="table-header-cell">Tipo</th>
              <th className="table-header-cell">Guía</th>
              <th className="table-header-cell">Nivel</th>
              <th className="table-header-cell">Step</th>
              <th className="table-header-cell">Asistió</th>
              <th className="table-header-cell">Canceló</th>
              <th className="table-header-cell">No Aprobó</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.length > 0 ? (
              filtered.map((item: any) => (
                <tr key={item._id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(item.fechaEvento)}
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${getTypeBadgeClass(item.tipoEvento)}`}>
                      {item.tipoEvento}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="text-sm text-gray-900">
                      {item.advisor ? (advisorNames[item.advisor] || item.advisor) : 'No asignado'}
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="text-sm text-gray-900">{item.nivel}</div>
                  </td>
                  <td className="table-cell">
                    <div className="text-sm text-gray-900">
                      {item.step}
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${item.asistencia ? 'badge-success' : 'badge-danger'}`}>
                      {item.asistencia ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    {item.cancelo ? (
                      <span className="badge badge-danger">Sí</span>
                    ) : (
                      <span className="text-gray-400 text-xl">-</span>
                    )}
                  </td>
                  <td className="table-cell text-center">
                    {item.noAprobo ? (
                      <span className="text-red-500 text-xl">✗</span>
                    ) : (
                      <span className="text-gray-400 text-xl">-</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="table-cell text-center text-gray-400 py-8">
                  No hay clases que coincidan con los filtros
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-2 text-right">
        {filtered.length} de {classes.length} registros
      </p>
    </div>
  )
}
