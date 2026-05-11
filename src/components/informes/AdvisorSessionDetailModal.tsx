'use client'

import { useState, useEffect } from 'react'
import { XMarkIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

interface SessionDetail {
  id: string; nombre: string; fecha: string; hora: string
  nivel: string; step: string; advisor: string
  capacidad: number; usuariosAgendados: number; asistieron: number; noAsistieron: number
}

interface UserRow {
  _id: string; nombre: string; email: string | null
  numeroId: string | null; estadoAsistencia: 'Asistió' | 'No asistió'
}

interface Props {
  eventId:  string | null
  onClose:  () => void
}

export default function AdvisorSessionDetailModal({ eventId, onClose }: Props) {
  const [loading,  setLoading]  = useState(false)
  const [session,  setSession]  = useState<SessionDetail | null>(null)
  const [users,    setUsers]    = useState<UserRow[]>([])
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!eventId) { setSession(null); setUsers([]); return }
    setLoading(true); setError(null)
    fetch(`/api/postgres/reports/programacion/advisors/sesion-detalle?eventId=${encodeURIComponent(eventId)}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error || 'Error al cargar detalle')
        setSession(json.data?.session ?? json.session)
        setUsers(json.data?.users ?? json.users ?? [])
      })
      .catch(e => setError(e.message || 'Error inesperado'))
      .finally(() => setLoading(false))
  }, [eventId])

  if (!eventId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-start justify-between rounded-t-2xl flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {loading ? 'Cargando...' : (session?.nombre || 'Detalle de Sesión')}
            </h2>
            {session && !loading && (
              <p className="text-xs text-gray-500 mt-0.5">
                {session.fecha} · {session.hora || 'Sin hora'} · {session.nivel} · {session.advisor}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 ml-4 flex-shrink-0">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {loading && (
            <div className="text-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Cargando usuarios...</p>
            </div>
          )}

          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
          )}

          {session && !loading && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Agendados',    value: session.usuariosAgendados, color: '#6366f1' },
                  { label: 'Asistieron',   value: session.asistieron,        color: '#10b981' },
                  { label: 'No Asistieron', value: session.noAsistieron,     color: '#ef4444' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg border border-gray-200 p-3 text-center">
                    <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Users table */}
              {users.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No hay usuarios agendados en esta sesión.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {['Nombre', 'Email', 'Número ID', 'Asistencia'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {users.map(u => (
                        <tr key={u._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-900">{u.nombre}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{u.email || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{u.numeroId || '—'}</td>
                          <td className="px-3 py-2.5">
                            {u.estadoAsistencia === 'Asistió' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                <CheckCircleIcon className="h-3.5 w-3.5" /> Asistió
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-medium">
                                <XCircleIcon className="h-3.5 w-3.5" /> No asistió
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex justify-end flex-shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
            Cerrar
          </button>
        </div>

      </div>
    </div>
  )
}
