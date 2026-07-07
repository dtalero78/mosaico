'use client'

import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import type { Permission } from '@/types/permissions'

export interface SessionRow {
  _id:           string
  fecha:         string
  hora:          string | null
  nivel:         string
  step:          string
  nombreEvento:  string
  advisorNombre: string
  capacidad:     number
  inscritos:     number
  asistentes:    number
  noAsistieron:  number
  pctAsistencia: number
}

interface Props {
  data:    SessionRow[]
  loading: boolean
  onRowClick: (row: SessionRow) => void
  filters: { fechaInicio: string; fechaFin: string }
  exportPermission: Permission
}

export default function AdvisorScheduleTable({ data, loading, onRowClick, filters, exportPermission }: Props) {
  const handleExport = () => {
    exportToExcel(
      data,
      [
        { header: 'Fecha',          accessor: r => r.fecha },
        { header: 'Hora',           accessor: r => r.hora ?? '' },
        { header: 'Nivel',          accessor: r => r.nivel },
        { header: 'Step',           accessor: r => r.step },
        { header: 'Nombre Sesión',  accessor: r => r.nombreEvento },
        { header: 'Guía',        accessor: r => r.advisorNombre },
        { header: 'Agendados',      accessor: r => r.inscritos },
        { header: 'Asistieron',     accessor: r => r.asistentes },
        { header: 'No Asistieron',  accessor: r => r.noAsistieron },
        { header: '% Asistencia',   accessor: r => r.pctAsistencia },
        { header: 'Capacidad',      accessor: r => r.capacidad },
      ],
      `informe-advisors-sesiones_${filters.fechaInicio}_${filters.fechaFin}`
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Detalle de Sesiones</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.length.toLocaleString()} sesiones · Haz clic en una fila para ver los usuarios
          </p>
        </div>
        <PermissionGuard permission={exportPermission}>
          <button type="button" onClick={handleExport} disabled={loading || data.length === 0}
            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar Excel
          </button>
        </PermissionGuard>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Cargando sesiones...</p>
        </div>
      ) : data.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-gray-400">No hay sesiones para el período y filtros seleccionados.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                {['Fecha','Hora','Nivel','Step','Nombre Sesión','Advisor',
                  'Agendados','Asistieron','No Asistieron','% Asist.','Capacidad'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(row => (
                <tr key={row._id}
                  onClick={() => onRowClick(row)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.fecha}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.hora ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">{row.nivel || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{row.step || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate" title={row.nombreEvento}>{row.nombreEvento || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[140px] truncate" title={row.advisorNombre}>{row.advisorNombre}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{row.inscritos}</td>
                  <td className="px-3 py-2 text-right font-medium text-green-600">{row.asistentes}</td>
                  <td className="px-3 py-2 text-right font-medium text-red-500">{row.noAsistieron}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-semibold ${row.pctAsistencia >= 75 ? 'text-green-600' : row.pctAsistencia >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {row.pctAsistencia}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{row.capacidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
