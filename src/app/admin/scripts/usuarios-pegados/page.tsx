'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { MantenimientoPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'

interface OverrideDetail {
  step: string
  isCompleted: boolean
}

interface PegadoRow {
  academicaId: string
  numeroId: string
  nombre: string
  contrato: string | null
  plataforma: string | null
  nivel: string
  stepActual: number
  stepReal: number
  desfase: number
  totalBookings: number
  clrHistoric: boolean
  overridesCount: number
  overrideDetails: OverrideDetail[]
}

interface PegadosResponse {
  calculatedAt: string
  rows: PegadoRow[]
  total: number
  cached: boolean
}

interface AplicarSummary {
  total: number
  ok: number
  alreadySynced: number
  blocked: number
  noChangeNeeded: number
  errors: number
}
interface AplicarItem {
  academicaId: string
  status: string
  from?: { nivel: string; step: string }
  to?:   { nivel: string; step: string }
  error?: string
}

const NIVELES = ['BN1', 'BN2', 'BN3', 'P1', 'P2', 'P3', 'F1', 'F2', 'F3']
const PLATAFORMAS = ['Chile', 'Colombia', 'Ecuador', 'Perú']

export default function UsuariosPegadosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.SCRIPTS_USUARIOS_PEGADOS} showDefaultMessage>
        <UsuariosPegadosContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function UsuariosPegadosContent() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PegadosResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [nivel, setNivel] = useState('')
  const [plataforma, setPlataforma] = useState('')
  const [desfaseMin, setDesfaseMin] = useState<number>(1)
  const [soloLimpios, setSoloLimpios] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ summary: AplicarSummary; results: AplicarItem[] } | null>(null)

  const fetchData = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/admin/scripts/usuarios-pegados${force ? '?force=1' : ''}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error cargando datos')
      // successResponse spreads at root: { success, calculatedAt, rows, total, cached }
      setData({
        calculatedAt: json.calculatedAt,
        rows:         json.rows ?? [],
        total:        json.total ?? 0,
        cached:       json.cached ?? false,
      })
      setSelected(new Set())
    } catch (err: any) {
      setError(err?.message || 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(false) }, [fetchData])

  const filtered = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (nivel && r.nivel !== nivel) return false
      if (plataforma && (r.plataforma || '').toLowerCase() !== plataforma.toLowerCase()) return false
      if (desfaseMin > 1 && r.desfase < desfaseMin) return false
      if (soloLimpios && (r.clrHistoric || r.overridesCount > 0)) return false
      if (term) {
        const hay = `${r.nombre} ${r.numeroId} ${r.contrato ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [data, search, nivel, plataforma, desfaseMin, soloLimpios])

  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selected.has(r.academicaId))
  const someVisibleSelected = filtered.some(r => selected.has(r.academicaId))

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      for (const r of filtered) next.add(r.academicaId)
      return next
    })
  }
  function selectOnlyClean() {
    setSelected(prev => {
      const next = new Set(prev)
      for (const r of filtered) {
        if (!r.clrHistoric && r.overridesCount === 0) next.add(r.academicaId)
      }
      return next
    })
  }
  function clearSelection() { setSelected(new Set()) }
  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        for (const r of filtered) next.delete(r.academicaId)
        return next
      })
    } else {
      selectAllVisible()
    }
  }

  function handleExport() {
    if (filtered.length === 0) { toast.error('No hay filas para exportar'); return }
    const rows = filtered.map(r => ({
      'Nombre':           r.nombre,
      'ID':               r.numeroId,
      'Contrato':         r.contrato ?? '',
      'Plataforma':       r.plataforma ?? '',
      'Nivel':            r.nivel,
      'Step Actual':      r.stepActual,
      'Step Real':        r.stepReal,
      'Desfase':          r.desfase,
      'Total Bookings':   r.totalBookings,
      'Clr Historic':     r.clrHistoric ? 'SI' : '—',
      'Overrides':        r.overridesCount,
      'Override Detalle': r.overrideDetails.map(o => `${o.step}=${o.isCompleted ? '✓' : '✗'}`).join(' | '),
      'AcademicaId':      r.academicaId,
    }))
    const columns = (Object.keys(rows[0]) as Array<keyof typeof rows[0]>).map(k => ({
      header: String(k),
      accessor: (row: typeof rows[0]) => row[k] as any,
    }))
    const today = new Date()
    const fname = `usuarios-pegados-${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}.csv`
    exportToExcel(rows, columns, fname)
  }

  const selectedRows = data ? data.rows.filter(r => selected.has(r.academicaId)) : []
  const resumenSeleccion = useMemo(() => {
    const porNivel: Record<string, number> = {}
    let desfaseTotal = 0
    for (const r of selectedRows) {
      porNivel[r.nivel] = (porNivel[r.nivel] || 0) + 1
      desfaseTotal += r.desfase
    }
    return {
      total: selectedRows.length,
      promedioDesfase: selectedRows.length > 0 ? (desfaseTotal / selectedRows.length).toFixed(1) : '0',
      porNivel,
      conClrHistoric: selectedRows.filter(r => r.clrHistoric).length,
      conOverrides: selectedRows.filter(r => r.overridesCount > 0).length,
    }
  }, [selectedRows])

  function openConfirm() {
    if (selectedRows.length === 0) { toast.error('Selecciona al menos un estudiante'); return }
    setMotivo(''); setShowConfirm(true)
  }
  function cancelConfirm() {
    if (applying) return
    setShowConfirm(false); setMotivo('')
  }

  async function applyChanges() {
    if (!motivo.trim()) { toast.error('El motivo es obligatorio'); return }
    if (selectedRows.length > 100) { toast.error('Máximo 100 estudiantes por operación'); return }

    setApplying(true)
    try {
      const res = await fetch('/api/admin/scripts/usuarios-pegados/aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaIds: selectedRows.map(r => r.academicaId),
          motivo: motivo.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error aplicando cambios')
      // successResponse spreads at root: { success, summary, results }
      setApplyResult({ summary: json.summary, results: json.results })
      setShowConfirm(false)
      await fetchData(true)
    } catch (err: any) {
      toast.error(err?.message || 'Error aplicando cambios')
    } finally {
      setApplying(false)
    }
  }

  function closeResult() { setApplyResult(null); setMotivo('') }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          🔧 Usuarios Pegados
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Estudiantes activos cuyo step actual está por debajo del step calculado a partir de sus bookings.
          Solo se listan casos donde <code>stepReal &gt; stepActual</code>; los movidos manualmente por admin (stepReal &lt; stepActual) no aparecen.
        </p>
        {data && (
          <p className="text-xs text-gray-500 mt-1">
            Última actualización: {new Date(data.calculatedAt).toLocaleString()} {data.cached && '(desde caché)'}
            {' · '}<span className="font-medium">{data.total} pegados</span>
          </p>
        )}
      </header>

      {/* Controles */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-3">
          <label htmlFor="search" className="block text-xs font-medium text-gray-700 mb-1">Buscar</label>
          <input
            id="search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Nombre, ID o contrato"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="nivel" className="block text-xs font-medium text-gray-700 mb-1">Nivel</label>
          <select
            id="nivel"
            value={nivel}
            onChange={e => setNivel(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            {NIVELES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="plataforma" className="block text-xs font-medium text-gray-700 mb-1">Plataforma</label>
          <select
            id="plataforma"
            value={plataforma}
            onChange={e => setPlataforma(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="md:col-span-1">
          <label htmlFor="desfaseMin" className="block text-xs font-medium text-gray-700 mb-1">Desfase ≥</label>
          <input
            id="desfaseMin"
            type="number" min={1} max={10}
            value={desfaseMin}
            onChange={e => setDesfaseMin(parseInt(e.target.value || '1', 10))}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="md:col-span-2 flex items-center pt-5">
          <input
            id="soloLimpios"
            type="checkbox"
            checked={soloLimpios}
            onChange={e => setSoloLimpios(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="soloLimpios" className="ml-2 text-xs text-gray-700">
            Solo casos limpios (sin flags)
          </label>
        </div>
        <div className="md:col-span-2 flex gap-2">
          <button
            type="button"
            onClick={() => fetchData(true)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-blue-600 text-sm font-medium rounded text-blue-600 hover:bg-blue-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Recalcular
          </button>
        </div>
      </div>

      {/* Toolbar de selección */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-700">
          <span className="font-semibold">{selectedRows.length}</span> seleccionados
          <span className="text-gray-500"> · {filtered.length} visibles · {data?.total ?? 0} totales</span>
        </span>
        <button
          type="button"
          onClick={selectAllVisible}
          disabled={filtered.length === 0}
          className="text-xs px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Marcar todos visibles
        </button>
        <button
          type="button"
          onClick={selectOnlyClean}
          disabled={filtered.length === 0}
          className="text-xs px-2.5 py-1 border border-green-300 rounded text-green-700 bg-white hover:bg-green-50 disabled:opacity-50"
        >
          Marcar solo limpios
        </button>
        <button
          type="button"
          onClick={clearSelection}
          disabled={selectedRows.length === 0}
          className="text-xs px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Desmarcar todo
        </button>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-green-600 text-sm font-medium rounded text-green-700 bg-white hover:bg-green-50 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={openConfirm}
            disabled={selectedRows.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            APLICAR CAMBIO ({selectedRows.length})
          </button>
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          Cargando estudiantes pegados…
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
          <ExclamationTriangleIcon className="h-5 w-5 inline mr-2" />
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-12 text-center text-green-700">
          <CheckCircleIcon className="h-10 w-10 mx-auto mb-2" />
          {data?.total === 0
            ? 'No hay estudiantes pegados — todo sincronizado.'
            : 'Ningún caso coincide con los filtros aplicados.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected }}
                    onChange={toggleAllVisible}
                    aria-label="Marcar/desmarcar todos los visibles"
                    className="rounded border-gray-300 text-blue-600"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Nombre</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">ID</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Contrato</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Plataforma</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Nivel</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Step Actual</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Step Real</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Desfase</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Clr Historic</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Overrides</th>
                <th className="px-3 py-2 text-center font-medium text-gray-700">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.academicaId} className={`border-b border-gray-100 hover:bg-blue-50/50 ${selected.has(r.academicaId) ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.academicaId)}
                      onChange={() => toggleOne(r.academicaId)}
                      aria-label={`Seleccionar ${r.nombre}`}
                      className="rounded border-gray-300 text-blue-600"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">{r.nombre}</td>
                  <td className="px-3 py-2 text-gray-600">{r.numeroId}</td>
                  <td className="px-3 py-2 text-gray-600">{r.contrato ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.plataforma ?? '—'}</td>
                  <td className="px-3 py-2 text-center font-medium text-gray-900">{r.nivel}</td>
                  <td className="px-3 py-2 text-center text-gray-900">{r.stepActual}</td>
                  <td className="px-3 py-2 text-center font-semibold text-blue-700">{r.stepReal}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${desfaseClass(r.desfase)}`}>
                      +{r.desfase}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.clrHistoric
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">🔧 SI</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.overridesCount === 0
                      ? <span className="text-gray-400">0</span>
                      : <OverridesBadge details={r.overrideDetails} />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <a
                      href={`/student/${r.academicaId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir panel del estudiante"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                      Ver <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de confirmación */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
                Confirmar reconciliación
              </h3>
              <button type="button" onClick={cancelConfirm} title="Cerrar" className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 space-y-3">
              <p className="text-sm text-gray-700">
                Vas a mover <strong>{resumenSeleccion.total}</strong> estudiantes a su step real calculado.
                Cada uno queda registrado en <code>cambioStepHistory</code> y en los comentarios de PEOPLE.
              </p>

              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs space-y-1">
                <div><strong>Promedio de avance:</strong> +{resumenSeleccion.promedioDesfase} steps</div>
                <div>
                  <strong>Por nivel:</strong>{' '}
                  {Object.entries(resumenSeleccion.porNivel).map(([n, c]) => `${n}: ${c}`).join(' · ')}
                </div>
                {resumenSeleccion.conClrHistoric > 0 && (
                  <div className="text-blue-700">
                    ⚠ {resumenSeleccion.conClrHistoric} con Clear Historic
                  </div>
                )}
                {resumenSeleccion.conOverrides > 0 && (
                  <div className="text-amber-700">
                    ⚠ {resumenSeleccion.conOverrides} con overrides activos
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="motivo" className="block text-sm font-medium text-gray-700 mb-1">
                  Motivo <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="motivo"
                  rows={3}
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  disabled={applying}
                  placeholder="Ej: Barrido mensual de estudiantes pegados detectados por bulk del 06-may"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  El motivo se incluye en cada entrada de auditoría y en el comentario de PEOPLE.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelConfirm}
                disabled={applying}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applyChanges}
                disabled={applying || !motivo.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {applying ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Procesando…
                  </>
                ) : (
                  `Confirmar (${resumenSeleccion.total})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de resultados */}
      {applyResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <CheckCircleIcon className="h-6 w-6 text-green-600" />
                Resultado de la reconciliación
              </h3>
              <button type="button" onClick={closeResult} title="Cerrar" className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2 mb-4 text-center text-xs">
              <Stat label="Total"          value={applyResult.summary.total}         color="bg-gray-100 text-gray-800" />
              <Stat label="OK"             value={applyResult.summary.ok}            color="bg-green-100 text-green-800" />
              <Stat label="Ya sincros."    value={applyResult.summary.alreadySynced} color="bg-blue-100 text-blue-800" />
              <Stat label="Bloqueados"     value={applyResult.summary.blocked}       color="bg-amber-100 text-amber-800" />
              <Stat label="Errores"        value={applyResult.summary.errors}        color="bg-red-100 text-red-800" />
            </div>

            {applyResult.summary.errors > 0 && (
              <div className="border border-red-200 rounded p-3 bg-red-50 mb-4">
                <p className="text-sm font-medium text-red-800 mb-2">Errores ({applyResult.summary.errors})</p>
                <ul className="text-xs text-red-700 space-y-1 max-h-40 overflow-y-auto">
                  {applyResult.results.filter(r => r.status === 'error').map(r => (
                    <li key={r.academicaId}><code>{r.academicaId}</code>: {r.error}</li>
                  ))}
                </ul>
              </div>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-gray-700 font-medium">Ver desglose completo</summary>
              <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 rounded">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">ID</th>
                      <th className="px-2 py-1 text-left">Estado</th>
                      <th className="px-2 py-1 text-left">De → A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applyResult.results.map(r => (
                      <tr key={r.academicaId} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-mono">{r.academicaId.slice(0, 12)}…</td>
                        <td className="px-2 py-1">{r.status}</td>
                        <td className="px-2 py-1">
                          {r.from && r.to
                            ? `${r.from.nivel} ${r.from.step} → ${r.to.nivel} ${r.to.step}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={closeResult}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function desfaseClass(d: number): string {
  if (d <= 1) return 'bg-gray-100 text-gray-700'
  if (d === 2) return 'bg-yellow-100 text-yellow-800'
  if (d === 3) return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

function OverridesBadge({ details }: { details: OverrideDetail[] }) {
  const ok = details.filter(d => d.isCompleted).length
  const block = details.filter(d => !d.isCompleted).length
  const title = details.map(d => `${d.step}=${d.isCompleted ? '✓ completo' : '✗ freno'}`).join('\n')
  return (
    <span title={title} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 cursor-help">
      {ok > 0 && <span>{ok} ✓</span>}
      {block > 0 && <span>{block} ✗</span>}
    </span>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`${color} rounded p-2`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  )
}
