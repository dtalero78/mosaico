'use client'

import { useEffect, useState } from 'react'
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Semana { inicio: string; fin: string }
interface Reporte {
  semanas: Semana[]
  semanaInicio: string
  disponible: boolean
  motivo?: string
  html?: string
}

const fmt = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('es', { day: '2-digit', month: 'short', timeZone: 'UTC' })

/**
 * Panel del estudiante › Reportes › Reporte académico.
 * Muestra por pantalla el reporte de una de las dos últimas semanas completas y
 * permite descargarlo en PDF.
 */
export default function ReporteAcademicoModal({ onClose }: { onClose: () => void }) {
  const [semana, setSemana] = useState('')
  const [reporte, setReporte] = useState<Reporte | null>(null)
  const [loading, setLoading] = useState(true)
  const [descargando, setDescargando] = useState(false)

  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch(`/api/postgres/panel-estudiante/reporte-academico${semana ? `?semana=${semana}` : ''}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!vivo) return
        if (j.error) throw new Error(j.error)
        setReporte(j.reporte)
        if (!semana) setSemana(j.reporte.semanaInicio)
      })
      .catch((e: any) => { if (vivo) toast.error(e?.message || 'No se pudo cargar el reporte') })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [semana])

  const descargar = async () => {
    setDescargando(true)
    try {
      const res = await fetch(`/api/postgres/panel-estudiante/reporte-academico/pdf?semana=${semana}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || 'No se pudo generar el PDF')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Reporte_academico_${semana}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo descargar')
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl h-[90vh] flex flex-col">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900">Reporte académico</h2>
          <div className="flex items-center gap-2 ml-auto">
            <label htmlFor="rep-semana" className="sr-only">Semana</label>
            <select id="rep-semana" value={semana} onChange={e => setSemana(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
              {(reporte?.semanas || []).map((s, i) => (
                <option key={s.inicio} value={s.inicio}>
                  {i === 0 ? 'Semana pasada' : 'Hace dos semanas'} · {fmt(s.inicio)} – {fmt(s.fin)}
                </option>
              ))}
            </select>
            <button type="button" onClick={descargar} disabled={!reporte?.disponible || descargando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              <ArrowDownTrayIcon className="h-4 w-4" />{descargando ? 'Generando…' : 'Descargar PDF'}
            </button>
            <button type="button" onClick={onClose} aria-label="Cerrar"
              className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-gray-50">
          {loading ? (
            <p className="p-10 text-center text-gray-400">Cargando…</p>
          ) : reporte?.disponible && reporte.html ? (
            <iframe title="Reporte académico" srcDoc={reporte.html} className="w-full h-full bg-white" />
          ) : (
            <p className="p-10 text-center text-gray-500">{reporte?.motivo || 'El reporte no está disponible.'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
