'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { estadoConfirmacion, HORAS_ANTES_CONFIRMACION } from '@/lib/nivelacion-confirmacion'

/**
 * Celda "Confirmación" de las pestañas de Nivelaciones.
 *
 * Vive en un solo componente porque la misma columna aparece en Solicitudes,
 * Agrupaciones, Pendientes e Histórico: cuatro copias del mismo semáforo
 * acabarían divergiendo, que es el problema que ya tuvimos con la columna Fecha.
 *
 * El estado sale del MISMO helper que usa el servidor para aceptar o rechazar la
 * confirmación (`lib/nivelacion-confirmacion`), así que lo que se ve aquí y lo
 * que el backend permite no se pueden separar.
 */
export default function ConfirmacionCell({
  academicaId, fechaSolicitud, fechaEvento, confirmadoEn, confirmadoPor, puedeGestionar, onConfirmed, soloLectura,
}: {
  academicaId?: string | null
  fechaSolicitud: string | null
  /** Horario asignado. El plazo se cuenta desde aquí; sin él, aún no corre. */
  fechaEvento?: string | null
  confirmadoEn: string | null
  confirmadoPor: string | null
  /** Permiso SERVICIO.NIVELACIONES.GESTION: habilita confirmar a mano. */
  puedeGestionar?: boolean
  onConfirmed?: () => void
  /** Histórico: la nivelación ya cerró, no hay nada que confirmar. */
  soloLectura?: boolean
}) {
  const [guardando, setGuardando] = useState(false)
  const estado = estadoConfirmacion({ fecha: fechaSolicitud, confirmadoEn }, new Date(), fechaEvento ?? null)

  if (estado === 'sin-solicitud') return <span className="text-gray-300">—</span>

  if (estado === 'confirmada') {
    const quien = confirmadoPor === 'SERVICIO' ? 'Confirmada por Servicio' : 'Confirmada por el usuario'
    const cuando = confirmadoEn ? new Date(confirmadoEn).toLocaleString('es-CL') : ''
    return (
      <span title={`${quien}${cuando ? ` · ${cuando}` : ''}`}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 whitespace-nowrap">
        ✓ Confirmada{confirmadoPor === 'SERVICIO' ? ' (Serv.)' : ''}
      </span>
    )
  }

  if (soloLectura) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 whitespace-nowrap">
        Sin confirmar
      </span>
    )
  }

  const confirmar = async () => {
    if (!academicaId) return
    setGuardando(true)
    try {
      const r = await fetch(`/api/postgres/students/${academicaId}/nivelacion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmar: true }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success('Confirmada')
      onConfirmed?.()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo confirmar')
    } finally { setGuardando(false) }
  }

  const vencida = estado === 'vencida'
  // El plazo se cuenta desde el horario asignado; sin agendamiento todavía no
  // corre, y el título lo dice para no dar a entender que el alumno se demoró.
  const badge = vencida
    ? { cls: 'bg-red-100 text-red-700', txt: 'Sin confirmar',
        title: `El plazo venció: quedan menos de ${HORAS_ANTES_CONFIRMACION} horas para la nivelación` }
    : fechaEvento
      ? { cls: 'bg-amber-100 text-amber-700', txt: 'Pendiente',
          title: `Puede confirmar hasta ${HORAS_ANTES_CONFIRMACION} horas antes de la nivelación` }
      : { cls: 'bg-amber-100 text-amber-700', txt: 'Pendiente',
          title: 'Sin horario asignado: el plazo empieza a correr cuando se agrupe' }

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span title={badge.title}
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
        {badge.txt}
      </span>
      {puedeGestionar && academicaId && (
        <button type="button" onClick={confirmar} disabled={guardando}
          title="Confirmar en nombre del usuario"
          className="text-xs px-1.5 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50">
          {guardando ? '…' : '✓'}
        </button>
      )}
    </span>
  )
}
