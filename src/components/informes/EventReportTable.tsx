'use client'

import type { TableRow, ReportConfig } from './event-report.types'
import { exportToExcel } from '@/lib/export-excel'
import { TYPE_COLORS } from './event-report.config'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'

interface Props {
  data:    TableRow[]
  config:  ReportConfig
  loading: boolean
  filters: { fechaInicio: string; fechaFin: string }
}

export default function EventReportTable({ data, config, loading, filters }: Props) {
  const handleExport = () => {
    exportToExcel(
      data,
      [
        { header: 'Fecha',          accessor: r => r.dia },
        { header: 'Hora',           accessor: r => r.hora ?? '' },
        { header: 'Tipo',           accessor: r => r.tipoDerivado },
        { header: 'Nivel',          accessor: r => r.nivel },
        { header: 'Step',           accessor: r => r.step },
        { header: 'Nombre Evento',  accessor: r => r.nombreEvento },
        { header: 'Guía',        accessor: r => r.advisorNombre },
        { header: 'Inscritos',      accessor: r => r.inscritos },
        { header: 'Asistentes',     accessor: r => r.asistentes },
        { header: 'Capacidad',      accessor: r => r.capacidad },
        { header: '% Asistencia',   accessor: r => r.pctAsistencia },
        { header: '% Ocupación',    accessor: r => r.pctOcupacion },
      ],
      `${config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${filters.fechaInicio}_${filters.fechaFin}`
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Detalle de Eventos</h3>
          <p className="text-xs text-gray-400 mt-0.5">{data.length.toLocaleString()} registros</p>
        </div>
        <PermissionGuard permission={config.exportPermission}>
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
          <p className="text-sm text-gray-400">Cargando datos...</p>
        </div>
      ) : data.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-gray-400">No hay eventos para el período y filtros seleccionados.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                {['Fecha','Hora','Tipo','Nivel','Nombre Evento','Advisor',
                  'Inscritos','Asistentes','Capacidad','% Asist.','% Ocup.'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(row => (
                <tr key={row._id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.dia}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.hora ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: TYPE_COLORS[row.tipoDerivado] ?? '#6b7280' }}>
                      {row.tipoDerivado}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{row.nivel || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={row.nombreEvento}>{row.nombreEvento || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[140px] truncate" title={row.advisorNombre}>{row.advisorNombre}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{row.inscritos}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{row.asistentes}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{row.capacidad}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-medium ${row.pctAsistencia >= 75 ? 'text-green-600' : row.pctAsistencia >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {row.pctAsistencia}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-medium ${row.pctOcupacion >= 75 ? 'text-green-600' : row.pctOcupacion >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {row.pctOcupacion}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
