'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { Permission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { usePermissions } from '@/hooks/usePermissions'

interface ExamInternStudent {
  _id: string
  numeroId: string | null
  primerNombre: string | null
  segundoNombre: string | null
  primerApellido: string | null
  segundoApellido: string | null
  celular: string | null
  email: string | null
  plataforma: string | null
  nivelacionGuia: string | null
  nivel: string | null
  step: string | null
  fechaPromocionEspecial: string | null
}

export interface ExamInternPageProps {
  /** NivelacionGuia value used for the GET query (e.g. 'IELTS'). */
  prueba: 'IELTS' | 'B2FIRST' | 'TOEFL'
  /** Display name shown in the page title and messages (e.g. 'IELTS', 'B2 First'). */
  displayName: string
  /** Permission required to access the page. */
  permVer: Permission
  /** Permission required to see the Export CSV button. */
  permExportar: Permission
  /** Permission required to see the CONFIRMADO column + Aplicar Confirmación button. */
  permAplicarConfirmacion: Permission
}

function fullName(s: ExamInternStudent): string {
  return [s.primerNombre, s.segundoNombre, s.primerApellido, s.segundoApellido]
    .filter(Boolean)
    .join(' ')
    .trim()
}

export default function ExamInternPage({
  prueba, displayName, permVer, permExportar, permAplicarConfirmacion,
}: ExamInternPageProps) {
  const { hasPermission, isRole } = usePermissions()
  const hasFullAccess = isRole('SUPER_ADMIN') || isRole('ADMIN')
  const canAplicar = hasFullAccess || hasPermission(permAplicarConfirmacion)

  const [students, setStudents] = useState<ExamInternStudent[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Filtros
  const [search, setSearch]         = useState('')
  const [startDate, setStartDate]   = useState('')
  const [endDate, setEndDate]       = useState('')
  const [plataforma, setPlataforma] = useState('')

  // Confirmación (checkboxes)
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set())

  // Modal Aplicar Confirmación
  const [showModal, setShowModal]   = useState(false)
  const [fechaBase, setFechaBase]   = useState(new Date().toISOString().split('T')[0])
  const [aplicando, setAplicando]   = useState(false)

  const loadStudents = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ prueba })
      if (search.trim()) params.set('search', search.trim())
      if (startDate)     params.set('startDate', startDate)
      if (endDate)       params.set('endDate', endDate)
      if (plataforma)    params.set('plataforma', plataforma)

      const res = await fetch(`/api/postgres/servicio/exam-intern?${params.toString()}`)
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`)
      const data = await res.json()
      if (data.success && Array.isArray(data.students)) {
        setStudents(data.students)
        setConfirmedIds(new Set()) // reset selections on each load
      } else {
        throw new Error(data.error || 'Respuesta inválida del servidor')
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStudents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearFilters = () => {
    setSearch(''); setStartDate(''); setEndDate(''); setPlataforma('')
  }

  const plataformasDistinct = useMemo(
    () => Array.from(new Set(students.map(s => s.plataforma).filter((p): p is string => !!p))).sort(),
    [students]
  )

  const handleExportCSV = () => {
    exportToExcel(students, [
      { header: 'Nombre Completo', accessor: s => fullName(s) },
      { header: 'Número ID',       accessor: s => s.numeroId || '' },
      { header: 'Celular',         accessor: s => s.celular || '' },
      { header: 'Email',           accessor: s => s.email || '' },
      { header: 'Plataforma',      accessor: s => s.plataforma || '' },
    ], `${prueba.toLowerCase()}-${new Date().toISOString().split('T')[0]}`)
  }

  const handleRowClick = (s: ExamInternStudent) => {
    if (s._id) window.open(`/student/${s._id}`, '_blank')
  }

  const toggleConfirmed = (id: string) => {
    setConfirmedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const counts = useMemo(() => {
    const confirmados   = students.filter(s => confirmedIds.has(s._id)).length
    const noConfirmados = students.length - confirmados
    return { confirmados, noConfirmados }
  }, [students, confirmedIds])

  const openModal = () => {
    if (students.length === 0) {
      toast.error('No hay estudiantes en la tabla')
      return
    }
    setFechaBase(new Date().toISOString().split('T')[0])
    setShowModal(true)
  }

  const handleAplicar = async () => {
    setAplicando(true)
    try {
      const confirmados   = students.filter(s => confirmedIds.has(s._id)).map(s => s._id)
      const noConfirmados = students.filter(s => !confirmedIds.has(s._id)).map(s => s._id)

      const res = await fetch('/api/postgres/servicio/exam-intern/aplicar-confirmacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prueba, fechaBase, confirmados, noConfirmados }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Error ${res.status}`)
      }
      const erroresTxt = data.errores && data.errores.length > 0
        ? ` · ${data.errores.length} error(es)`
        : ''
      toast.success(
        `${data.extendidos} extendido(s), ${data.bloqueados} bloqueado(s). ` +
        `WhatsApp: ${data.whatsappEnviados}/${data.whatsappEnviados + data.whatsappFallidos} OK${erroresTxt}`,
        { duration: 6000 }
      )
      setShowModal(false)
      await loadStudents()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || 'Error al aplicar confirmación')
    } finally {
      setAplicando(false)
    }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={permVer}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🎓 Exam. Intern. — {displayName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Estudiantes con <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">nivelacionGuia = {prueba}</code> o <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">step = Step {prueba === 'IELTS' ? 47 : prueba === 'B2FIRST' ? 48 : 49}</code>
            </p>
          </div>

          <div className="card">
            <div className="card-header pb-6">
              <div className="flex items-center justify-end gap-3 flex-wrap">
                <PermissionGuard permission={permExportar}>
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    disabled={students.length === 0}
                    className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Exportar CSV
                  </button>
                </PermissionGuard>

                <button
                  type="button"
                  onClick={loadStudents}
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Cargando...' : 'Aplicar filtros'}
                </button>

                <PermissionGuard permission={permAplicarConfirmacion}>
                  <button
                    type="button"
                    onClick={openModal}
                    disabled={students.length === 0 || aplicando}
                    className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    APLICAR CONFIRMACIÓN
                  </button>
                </PermissionGuard>
              </div>
            </div>

            <div className="card-content">
              {/* Filtros */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div>
                    <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                      Buscar por apellido o ID
                    </label>
                    <input
                      type="text" id="search" value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Apellido o número de ID..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">Promoción desde</label>
                    <input type="date" id="startDate" value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">Promoción hasta</label>
                    <input type="date" id="endDate" value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="plataforma" className="block text-sm font-medium text-gray-700 mb-1">Plataforma</label>
                    <select id="plataforma" value={plataforma}
                      onChange={e => setPlataforma(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                      <option value="">Todas</option>
                      {plataformasDistinct.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <button type="button" onClick={clearFilters}
                      className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">
                      Limpiar filtros
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  {students.length} estudiante{students.length !== 1 ? 's' : ''}
                  {canAplicar && students.length > 0 && (
                    <> · {counts.confirmados} confirmado{counts.confirmados !== 1 ? 's' : ''} / {counts.noConfirmados} pendiente{counts.noConfirmados !== 1 ? 's' : ''}</>
                  )}
                </div>
              </div>

              {error ? (
                <div className="alert alert-error">
                  <div className="flex">
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Error al cargar estudiantes</h3>
                      <p className="mt-2 text-sm text-red-700">{error}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead className="table-header">
                      <tr>
                        <th className="table-header-cell">Nombre Completo</th>
                        <th className="table-header-cell">Celular</th>
                        <th className="table-header-cell">Email</th>
                        <th className="table-header-cell">Plataforma</th>
                        {canAplicar && (
                          <th className="table-header-cell text-center">CONFIRMADO</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="table-body">
                      {students.length > 0 ? (
                        students.map(s => (
                          <tr key={s._id}
                            className="hover:bg-gray-50 transition-colors">
                            <td className="table-cell cursor-pointer" onClick={() => handleRowClick(s)}>
                              <div className="text-sm font-medium text-gray-900">{fullName(s) || 'Sin nombre'}</div>
                              {s.numeroId && <div className="text-xs text-gray-500">ID: {s.numeroId}</div>}
                            </td>
                            <td className="table-cell cursor-pointer" onClick={() => handleRowClick(s)}>
                              <div className="text-sm text-gray-500">{s.celular || 'N/A'}</div>
                            </td>
                            <td className="table-cell cursor-pointer" onClick={() => handleRowClick(s)}>
                              <div className="text-sm text-gray-500">{s.email || 'N/A'}</div>
                            </td>
                            <td className="table-cell cursor-pointer" onClick={() => handleRowClick(s)}>
                              <div className="text-sm text-gray-500">{s.plataforma || 'N/A'}</div>
                            </td>
                            {canAplicar && (
                              <td className="table-cell text-center">
                                <input
                                  type="checkbox"
                                  checked={confirmedIds.has(s._id)}
                                  onChange={() => toggleConfirmed(s._id)}
                                  onClick={e => e.stopPropagation()}
                                  className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                />
                              </td>
                            )}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={canAplicar ? 5 : 4} className="text-center py-8 text-sm text-gray-500">
                            {loading ? 'Cargando...' : `No hay usuarios para la prueba ${displayName}.`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Modal Aplicar Confirmación ─────────────────────────────────── */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-gray-900">⚠️ Aplicar Confirmación {displayName}</h3>

              <div>
                <label htmlFor="fechaBase" className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha base del proceso *
                </label>
                <input
                  type="date" id="fechaBase" value={fechaBase}
                  onChange={e => setFechaBase(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Los confirmados recibirán <strong>finalContrato = fecha base + 100 días</strong>.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-green-600 font-bold">✅</span>
                  <div>
                    <strong>{counts.confirmados}</strong> CONFIRMADO{counts.confirmados !== 1 ? 'S' : ''}:
                    extensión 100 días, {displayName} Step activo, WhatsApp enviado.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-red-600 font-bold">🛑</span>
                  <div>
                    <strong>{counts.noConfirmados}</strong> NO CONFIRMADO{counts.noConfirmados !== 1 ? 'S' : ''}:
                    promovidos a DONE Step 50 y bloqueados.
                  </div>
                </div>
              </div>

              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                Esta acción es <strong>IRREVERSIBLE</strong>. Verifica las casillas antes de continuar.
              </p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={aplicando}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAplicar}
                  disabled={aplicando || !fechaBase}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {aplicando ? 'Aplicando...' : 'Confirmar Aplicación'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
