'use client'

import { useEffect, useState } from 'react'
import { Student } from '@/types'

interface Entry {
  fecha?: string
  fechaEvento?: string | null
  conteo?: number
  resultado?: 'REALIZADA' | 'NO_ASISTIO' | string
  comentario?: string
  marcadoPor?: string
}

interface Props {
  student: Student
}

/**
 * Historial de nivelaciones del estudiante (ACADEMICA.NivelacionHistory).
 * Muestra cada registro (fecha del evento, conteo, resultado y comentario),
 * ordenado de la más ANTIGUA a la más NUEVA (por fecha del evento).
 */
export default function StudentNivelacionHistorial({ student }: Props) {
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!student?._id) return
    setLoading(true)
    fetch(`/api/postgres/students/${student._id}/nivelacion`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const hist: Entry[] = Array.isArray(d.historial) ? d.historial : []
        // Orden ascendente por fecha del evento (fallback a fecha de registro)
        hist.sort((a, b) => {
          const fa = new Date(a.fechaEvento || a.fecha || 0).getTime()
          const fb = new Date(b.fechaEvento || b.fecha || 0).getTime()
          return fa - fb
        })
        setRows(hist)
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [student?._id])

  const fmt = (iso?: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">Nivelación Historial</h3>
      <p className="text-sm text-gray-500 mb-5">
        Registros de nivelación del estudiante (de la más antigua a la más nueva). Total: <span className="font-semibold text-gray-700">{rows.length}</span>
      </p>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Conteo', 'Fecha del evento', 'Resultado', 'Comentario', 'Marcado por'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">Sin registros de nivelación</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                      {r.conteo ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmt(r.fechaEvento || r.fecha)}</td>
                  <td className="px-3 py-2">
                    {r.resultado === 'REALIZADA' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Realizada</span>
                    ) : r.resultado === 'NO_ASISTIO' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">No asistió</span>
                    ) : (
                      <span className="text-gray-500">{r.resultado || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.comentario || '—'}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.marcadoPor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
