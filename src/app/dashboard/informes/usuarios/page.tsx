'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { MagnifyingGlassIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { exportToExcel } from '@/lib/export-excel'

const today       = new Date().toISOString().split('T')[0]
const firstOfYear = `${new Date().getFullYear()}-01-01`

const NIVELES = ['BN1','BN2','BN3','P1','P2','P3','F1','F2','F3','ESS','WELCOME']

interface Record {
  _id: string
  fechaEvento: string
  tipo: string
  advisor: string
  nivel: string
  step: string
  asistio: boolean
  asistencia: boolean
  participacion: boolean
  noAprobo: boolean
}

interface Student {
  nombre: string
  nivel: string
  numeroId: string
}

export default function InformesUsuariosPage() {
  const [numeroId,  setNumeroId]  = useState('')
  const [startDate, setStartDate] = useState(firstOfYear)
  const [endDate,   setEndDate]   = useState(today)
  const [nivel,     setNivel]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [records,   setRecords]   = useState<Record[] | null>(null)
  const [student,   setStudent]   = useState<Student | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  const handleSearch = async () => {
    if (!numeroId.trim()) { setError('Ingrese el número de ID del usuario'); return }
    setLoading(true)
    setError(null)
    setRecords(null)
    setStudent(null)
    try {
      const qs = new URLSearchParams({ numeroId: numeroId.trim() })
      if (startDate) qs.set('startDate', startDate)
      if (endDate)   qs.set('endDate',   endDate)
      if (nivel)     qs.set('nivel',     nivel)

      const res  = await fetch(`/api/postgres/reports/asistencia/usuario?${qs}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error al consultar')
      setStudent(data.student)
      setRecords(data.records)
    } catch (e: any) {
      setError(e.message || 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const handleCSV = () => {
    if (!records || !student) return
    exportToExcel(
      records,
      [
        { header: 'Fecha',        accessor: r => r.fechaEvento ? new Date(r.fechaEvento).toLocaleString('es-CO') : '' },
        { header: 'Tipo',         accessor: r => r.tipo || '' },
        { header: 'Advisor',      accessor: r => r.advisor || '' },
        { header: 'Nivel',        accessor: r => r.nivel || '' },
        { header: 'Step',         accessor: r => r.step || '' },
        { header: 'Asistió',      accessor: r => (r.asistio || r.asistencia) ? 'Sí' : 'No' },
        { header: 'Participó',    accessor: r => r.participacion ? 'Sí' : 'No' },
        { header: 'No Aprobó',    accessor: r => r.noAprobo ? 'Sí' : 'No' },
      ],
      `asistencia_${student.numeroId}_${startDate}_${endDate}`
    )
  }

  const asistioFlag = (r: Record) => r.asistio || r.asistencia

  return (
    <DashboardLayout>
      <div className="space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">Informe de Asistencia — Usuario</h1>
          <p className="text-sm text-gray-500 mt-0.5">Historial de clases de un beneficiario por número de ID</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-end gap-3">

            {/* Número ID */}
            <div>
              <label htmlFor="u-id" className="block text-xs text-gray-500 mb-1">Número de ID *</label>
              <input id="u-id" type="text" value={numeroId}
                onChange={e => setNumeroId(e.target.value.replace(/[^A-Z0-9]/g,'').toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Ej: 280601004"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
              />
            </div>

            {/* Fecha inicial */}
            <div>
              <label htmlFor="u-start" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
              <input id="u-start" type="date" value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Fecha final */}
            <div>
              <label htmlFor="u-end" className="block text-xs text-gray-500 mb-1">Fecha final</label>
              <input id="u-end" type="date" value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Nivel */}
            <div>
              <label htmlFor="u-nivel" className="block text-xs text-gray-500 mb-1">Nivel</label>
              <select id="u-nivel" value={nivel} onChange={e => setNivel(e.target.value)}
                title="Filtrar por nivel"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Todos los niveles</option>
                {NIVELES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 ml-auto">
              <button type="button"
                onClick={() => { setNumeroId(''); setStartDate(firstOfYear); setEndDate(today); setNivel(''); setRecords(null); setStudent(null); setError(null) }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                Limpiar
              </button>
              <button type="button" onClick={handleSearch} disabled={loading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                <MagnifyingGlassIcon className="h-4 w-4" />
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        )}

        {/* Results */}
        {records !== null && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

            {/* Student info + CSV */}
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{student?.nombre}</p>
                <p className="text-xs text-gray-500">ID: {student?.numeroId} · Nivel actual: {student?.nivel}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{records.length} registro{records.length !== 1 ? 's' : ''}</span>
                {records.length > 0 && (
                  <button type="button" onClick={handleCSV}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    Descargar CSV
                  </button>
                )}
              </div>
            </div>

            {/* No records */}
            {records.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-gray-500 text-sm">No se encontraron agendamientos para este usuario con los filtros aplicados.</p>
                <p className="text-gray-400 text-xs mt-1">Intente ampliar el rango de fechas o cambiar el nivel.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['FECHA','TIPO','ADVISOR','NIVEL','STEP','ASISTIÓ','PARTICIPÓ','NO APROBÓ'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {records.map(r => (
                      <tr key={r._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {r.fechaEvento ? new Date(r.fechaEvento).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold
                            ${r.tipo === 'SESSION' ? 'bg-blue-100 text-blue-800'
                              : r.tipo === 'CLUB' ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-700'}`}>
                            {r.tipo || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-blue-600">{r.advisor || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{r.nivel || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{r.step || '—'}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`font-medium ${asistioFlag(r) ? 'text-green-600' : 'text-red-500'}`}>
                            {asistioFlag(r) ? 'Sí' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{r.participacion ? 'Sí' : '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{r.noAprobo ? 'Sí' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
