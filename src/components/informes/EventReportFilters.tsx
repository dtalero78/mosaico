'use client'

import type { FilterState } from './event-report.types'
import type { Permission } from '@/types/permissions'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'

interface Props {
  filters:            FilterState
  onChange:           (f: FilterState) => void
  onApply:            () => void
  onClear:            () => void
  onExport:           () => void
  showTipoClubFilter: boolean
  niveles:            string[]
  horas:              string[]
  advisors:           string[]
  loading:            boolean
  exportPermission:   Permission
}

export default function EventReportFilters({
  filters, onChange, onApply, onClear, onExport,
  showTipoClubFilter, niveles, horas, advisors, loading, exportPermission,
}: Props) {
  const set = (key: keyof FilterState, val: string) =>
    onChange({ ...filters, [key]: val })

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex flex-wrap items-end gap-3">

        <div>
          <label htmlFor="er-inicio" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
          <input id="er-inicio" type="date" value={filters.fechaInicio}
            onChange={e => set('fechaInicio', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label htmlFor="er-fin" className="block text-xs text-gray-500 mb-1">Fecha final</label>
          <input id="er-fin" type="date" value={filters.fechaFin}
            onChange={e => set('fechaFin', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label htmlFor="er-nivel" className="block text-xs text-gray-500 mb-1">Nivel</label>
          <select id="er-nivel" value={filters.nivel} onChange={e => set('nivel', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[110px]">
            <option value="">Todos</option>
            {niveles.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="er-hora" className="block text-xs text-gray-500 mb-1">Hora</label>
          <select id="er-hora" value={filters.hora} onChange={e => set('hora', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[100px]">
            <option value="">Todas</option>
            {horas.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="er-advisor" className="block text-xs text-gray-500 mb-1">Guía</label>
          <select id="er-advisor" value={filters.advisorNombre} onChange={e => set('advisorNombre', e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]">
            <option value="">Todos</option>
            {advisors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {showTipoClubFilter && (
          <div>
            <label htmlFor="er-club" className="block text-xs text-gray-500 mb-1">Tipo de Taller</label>
            <input id="er-club" type="text" value={filters.tipoClub}
              onChange={e => set('tipoClub', e.target.value)}
              placeholder="Ej: Listening"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36" />
          </div>
        )}

        <div className="flex gap-2 ml-auto flex-wrap">
          <button type="button" onClick={onApply} disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
            Aplicar filtros
          </button>
          <button type="button" onClick={onClear} disabled={loading}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
            Limpiar filtros
          </button>
          <PermissionGuard permission={exportPermission}>
            <button type="button" onClick={onExport} disabled={loading}
              className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Exportar Excel
            </button>
          </PermissionGuard>
        </div>
      </div>
    </div>
  )
}
