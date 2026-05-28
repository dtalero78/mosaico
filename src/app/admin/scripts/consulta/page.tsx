'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  CommandLineIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { MantenimientoPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'

interface ScriptInfo {
  name: string
  utilidad: string
  ejecucion: string
  requiereParametros: boolean
  parametros: string
  tipo: 'Solo lectura' | 'Escribe' | 'Escribe (--apply)'
}

interface CatalogResponse {
  scripts: ScriptInfo[]
  total: number
  generatedAt: string
}

export default function ConsultaScriptsPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.SCRIPTS_CONSULTA} showDefaultMessage>
        <ConsultaScriptsContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

const TIPO_BADGE: Record<ScriptInfo['tipo'], string> = {
  'Solo lectura': 'bg-green-100 text-green-800',
  'Escribe': 'bg-red-100 text-red-800',
  'Escribe (--apply)': 'bg-amber-100 text-amber-800',
}

function ConsultaScriptsContent() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tipo, setTipo] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/scripts/catalog', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error cargando el catálogo')
      // successResponse hace spread en la raíz: { success, scripts, total, generatedAt }
      setData({ scripts: json.scripts ?? [], total: json.total ?? 0, generatedAt: json.generatedAt })
    } catch (err: any) {
      setError(err.message || 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = useMemo(() => {
    const rows = data?.scripts ?? []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (tipo && r.tipo !== tipo) return false
      if (!q) return true
      return r.name.toLowerCase().includes(q) || r.utilidad.toLowerCase().includes(q)
    })
  }, [data, search, tipo])

  const handleExport = () => {
    if (!filtered.length) { toast.error('No hay scripts para exportar'); return }
    exportToExcel(
      filtered,
      [
        { header: 'Script', accessor: (r) => r.name },
        { header: 'Utilidad', accessor: (r) => r.utilidad },
        { header: 'Ejecución', accessor: (r) => r.ejecucion },
        { header: 'Requiere parámetros', accessor: (r) => (r.requiereParametros ? 'Sí' : 'No') },
        { header: 'Parámetros', accessor: (r) => r.parametros },
        { header: 'Tipo', accessor: (r) => r.tipo },
      ],
      'consulta-scripts'
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <CommandLineIcon className="h-7 w-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Consulta de Scripts</h1>
            <p className="text-sm text-gray-500">
              Catálogo de los scripts del repositorio: utilidad, comando de ejecución, parámetros y tipo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-4 w-4" /> Recargar
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <ArrowDownTrayIcon className="h-4 w-4" /> Descargar CSV
          </button>
        </div>
      </div>

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
        Referencia informativa. Esta pantalla <strong>no ejecuta</strong> scripts; solo los lista. El tipo
        (lectura/escritura) y los parámetros se infieren del código y pueden no ser exhaustivos — verifica el
        encabezado del archivo antes de correrlo desde el servidor.
      </p>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[260px]">
          <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o utilidad…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-md"
        >
          <option value="">Todos los tipos</option>
          <option value="Solo lectura">Solo lectura</option>
          <option value="Escribe">Escribe</option>
          <option value="Escribe (--apply)">Escribe (--apply)</option>
        </select>
        <span className="text-sm text-gray-500">
          {filtered.length} de {data?.total ?? 0} scripts
        </span>
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando catálogo…</div>
      ) : error ? (
        <div className="text-center py-12 text-red-600">{error}</div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Script</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Utilidad</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Ejecución</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-700">¿Parámetros?</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Parámetros</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-700">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((r) => (
                <tr key={r.name} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-md">{r.utilidad}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{r.ejecucion}</td>
                  <td className="px-3 py-2 text-center">
                    {r.requiereParametros
                      ? <span className="text-indigo-700 font-medium">Sí</span>
                      : <span className="text-gray-400">No</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.parametros}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TIPO_BADGE[r.tipo]}`}>
                      {r.tipo}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                    No hay scripts que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.generatedAt && (
        <p className="text-xs text-gray-400 mt-3">
          Generado: {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}
