'use client'

import { useState, useEffect } from 'react'
import { Student } from '@/types'

interface Leccion {
  orden: number
  leccion: string
  estado: 'aprobada' | 'no_aprobada' | 'ausente' | 'programada' | 'pendiente'
  mensaje: string | null
  refuerzo: boolean
  fecha: string | null
}
interface Modulo {
  modulo: string
  esActual: boolean
  completo: boolean
  total: number
  aprobadas: number
  porcentaje: number
  faltan: number
  lecciones: Leccion[]
}
interface Report {
  student: { nombre: string; curso: string | null; moduloActual: string | null; leccionActual: string | null }
  resumen: {
    curso: string | null; moduloActual: string | null
    modulosCompletos: number; totalModulos: number
    leccionesAprobadasModulo: number; totalLeccionesModulo: number
    porcentajeModulo: number; faltanModulo: number
    totalClases: number; totalAsistencias: number; totalAusencias: number; porcentajeAsistencia: number
    mapeoPendiente?: boolean
  }
  modulos: Modulo[]
  nivelacion: { activa: boolean; modulo: string | null; leccion: string | null; aprobada: boolean } | null
}

const ESTADO_META: Record<Leccion['estado'], { label: string; cls: string }> = {
  aprobada:    { label: 'Aprobada',    cls: 'bg-green-100 text-green-800' },
  no_aprobada: { label: 'No aprobada', cls: 'bg-amber-100 text-amber-800' },
  ausente:     { label: 'Ausente',     cls: 'bg-red-100 text-red-800' },
  programada:  { label: 'Programada',  cls: 'bg-gray-100 text-gray-600' },
  pendiente:   { label: 'Pendiente',   cls: 'bg-gray-100 text-gray-500' },
}
const fmtFecha = (iso: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: '2-digit' }) } catch { return '—' }
}

export default function StudentProgress({ student }: { student: Student }) {
  const [report, setReport] = useState<Report | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selModulo, setSelModulo] = useState<string | null>(null)

  useEffect(() => { loadProgressData() /* eslint-disable-next-line */ }, [student._id])

  const loadProgressData = async () => {
    try {
      setIsLoading(true); setError(null)
      const response = await fetch(`/api/postgres/students/${student._id}/progress`)
      if (!response.ok) throw new Error('Error al cargar el diagnóstico académico')
      const result = await response.json()
      if (!result.success) throw new Error(result.error || 'Error al cargar el diagnóstico académico')
      setReport(result as Report)
      setSelModulo((result.resumen?.moduloActual) || result.modulos?.[0]?.modulo || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally { setIsLoading(false) }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin mr-3 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-gray-600">Cargando diagnóstico académico...</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className="card"><div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-red-800">Error al cargar el diagnóstico</h3>
        <p className="mt-1 text-sm text-red-700">{error}</p>
        <button onClick={loadProgressData} className="mt-3 btn-secondary text-sm">Reintentar</button>
      </div></div>
    )
  }
  if (!report) return <div className="card"><p className="text-gray-500 text-center py-8">No hay datos disponibles</p></div>

  const { resumen, modulos, nivelacion } = report
  const modSel = modulos.find((m) => m.modulo === selModulo) || modulos.find((m) => m.esActual) || modulos[0] || null

  return (
    <div className="space-y-4">
      {/* Resumen general */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center"><p className="text-2xl font-bold text-blue-600">{resumen.totalClases}</p><p className="text-xs text-gray-500 mt-1">Total Clases</p></div>
        <div className="card text-center"><p className="text-2xl font-bold text-green-600">{resumen.totalAsistencias}</p><p className="text-xs text-gray-500 mt-1">Asistencias</p></div>
        <div className="card text-center"><p className="text-2xl font-bold text-red-600">{resumen.totalAusencias}</p><p className="text-xs text-gray-500 mt-1">Ausencias</p></div>
        <div className="card text-center"><p className="text-2xl font-bold text-purple-600">{resumen.porcentajeAsistencia}%</p><p className="text-xs text-gray-500 mt-1">% Asistencia</p></div>
      </div>

      {resumen.mapeoPendiente && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          ⚠ Este curso aún no tiene el mapeo de lecciones cargado. Corre el backfill de mapeo para ver el detalle por lección.
        </div>
      )}

      {nivelacion?.activa && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
          🔁 <strong>Nivelación {nivelacion.aprobada ? 'realizada' : 'programada'}</strong>
          {nivelacion.leccion ? ` — ${nivelacion.modulo ? nivelacion.modulo + ' · ' : ''}${nivelacion.leccion}` : ''}
          {!nivelacion.aprobada && ' (pendiente con el guía)'}
        </div>
      )}

      {/* Progreso del curso / módulos */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-700">
            {resumen.curso ? `Curso ${resumen.curso}` : 'Progreso'} · Módulo actual: {resumen.moduloActual || '—'}
          </h3>
          <span className="text-sm text-gray-500">{resumen.modulosCompletos} / {resumen.totalModulos} módulos completos</span>
        </div>

        {/* Chips de módulos (clic para ver sus lecciones) */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {modulos.map((m) => {
            const active = m.modulo === modSel?.modulo
            const color = m.completo ? 'bg-green-100 text-green-800 border-green-200'
              : m.esActual ? 'bg-blue-100 text-blue-800 border-blue-300'
              : 'bg-gray-50 text-gray-600 border-gray-200'
            return (
              <button key={m.modulo} type="button" onClick={() => setSelModulo(m.modulo)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${color} ${active ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}>
                {m.modulo} <span className="font-semibold">{m.aprobadas}/{m.total}</span>
                {m.esActual && <span className="text-[9px] uppercase">actual</span>}
              </button>
            )
          })}
        </div>

        {modSel && (
          <>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">{modSel.modulo}</span>
              <span className="text-xs text-gray-500">{modSel.aprobadas} / {modSel.total} lecciones aprobadas</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
              <div className="bg-blue-600 h-2.5 rounded-full transition-all" style={{ width: `${modSel.porcentaje}%` }} />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Lección</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Fecha</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Diagnóstico</th>
                  </tr>
                </thead>
                <tbody>
                  {modSel.lecciones.map((l) => (
                    <tr key={`${l.orden}-${l.leccion}`} className="border-b border-gray-100">
                      <td className="py-2 px-3 font-medium text-gray-900">
                        <span className="flex items-center gap-1.5">
                          {l.leccion}
                          {l.refuerzo && <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-1 py-0.5 rounded">🔁 REFUERZO</span>}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_META[l.estado].cls}`}>
                          {ESTADO_META[l.estado].label}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500">{fmtFecha(l.fecha)}</td>
                      <td className="py-2 px-3 text-xs text-gray-500 italic">{l.mensaje || (l.estado === 'aprobada' ? 'Asistió y aprobó' : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={loadProgressData} className="btn-secondary text-sm" disabled={isLoading}>Actualizar</button>
      </div>
    </div>
  )
}
