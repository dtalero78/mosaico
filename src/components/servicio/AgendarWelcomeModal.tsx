'use client'

import { useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import SobrecupoModal, { esSobrecupo, type SobrecupoDetalle } from '@/components/common/SobrecupoModal'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'
import { formatDateTime } from '@/lib/utils'

/** Una sesión WELCOME futura a la que se puede agendar al alumno. */
interface EventoFuturo {
  _id: string
  fechaEvento: string
  hora: string | null
  modulo: string
  advisorNombre: string
  limiteUsuarios: number
  inscritos: number
}

interface Props {
  /** ACADEMICA._id del alumno. */
  studentId: string
  nombre: string
  /** Curso real del alumno: decide de qué módulo se ofrecen las sesiones. */
  tipoCurso: string
  titulo: string
  /** Texto de contexto bajo el título (qué pasa al agendar). */
  aviso: ReactNode
  /** Texto del botón de confirmar ("Reagendar", "Agendar"). */
  accion: string
  onClose: () => void
  onAgendado: () => void
}

/**
 * Agenda a un alumno en una sesión WELCOME futura de SU módulo. Lo comparten las
 * pestañas de Reagendamientos y de Pendientes de agendar: es la misma escritura
 * (`/events/welcome/reagendar`, con su permiso, cupo, tope de 2 y sobrecupo), y
 * con una copia en cada una la primera corrección las desalinea.
 */
export default function AgendarWelcomeModal({ studentId, nombre, tipoCurso, titulo, aviso, accion, onClose, onAgendado }: Props) {
  const { hasPermission } = usePermissions()
  // Autorizar sobrecupo es un permiso aparte del de agendar.
  const puedeAutorizarSobrecupo = hasPermission(AcademicoPermission.SOBRECUPO_AUTORIZAR)

  const [opciones, setOpciones] = useState<EventoFuturo[]>([])
  const [moduloDestino, setModuloDestino] = useState('')
  const [cargando, setCargando] = useState(true)
  const [elegido, setElegido] = useState('')
  const [guardando, setGuardando] = useState(false)
  /** Detalle de la sesión llena; abre el modal de sobrecupo cuando llega. */
  const [sobrecupo, setSobrecupo] = useState<SobrecupoDetalle | null>(null)

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const res = await fetch(`/api/postgres/events/welcome?mode=futuros&curso=${encodeURIComponent(tipoCurso || '')}`)
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
        if (!vigente) return
        setOpciones(data.events || [])
        setModuloDestino(data.modulo || '')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las sesiones')
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => { vigente = false }
  }, [tipoCurso])

  const confirmar = async (autorizarSobrecupo = false) => {
    if (!elegido) return
    setGuardando(true)
    try {
      const res = await fetch('/api/postgres/events/welcome/reagendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventoId: elegido, studentId, autorizarSobrecupo }),
      })
      const data = await res.json()
      // Sesión llena: el modal dice cuánto se pasa y lo autoriza quien pueda.
      if (!res.ok && esSobrecupo(data?.detail)) { setSobrecupo(data.detail); return }
      if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
      toast.success(`${nombre}: sesión de bienvenida agendada.`)
      onAgendado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo agendar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="px-6 py-4 border-b">
            <h3 className="text-lg font-semibold text-gray-900">{titulo}</h3>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-medium">{nombre}</span>
              {tipoCurso ? ` · ${tipoCurso}` : ''}
              {moduloDestino ? ` · módulo ${moduloDestino}` : ''}
            </p>
          </div>

          <div className="px-6 py-4">
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">{aviso}</div>

            {cargando ? (
              <div className="py-8 text-center text-sm text-gray-500">Cargando sesiones disponibles…</div>
            ) : opciones.length === 0 ? (
              <div className="py-6 px-4 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                No hay sesiones WELCOME futuras del módulo <strong>{moduloDestino || '—'}</strong>.
                Hay que crear una en el Calendario de Eventos antes de poder agendar.
              </div>
            ) : (
              <div className="space-y-2">
                {opciones.map((ev) => {
                  const lleno = ev.limiteUsuarios > 0 && ev.inscritos >= ev.limiteUsuarios
                  return (
                    <label
                      key={ev._id}
                      className={`flex items-center gap-3 p-3 border rounded-md ${
                        lleno
                          ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                          : elegido === ev._id
                          ? 'bg-purple-50 border-purple-400 cursor-pointer'
                          : 'bg-white border-gray-300 hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="eventoDestino"
                        value={ev._id}
                        disabled={lleno}
                        checked={elegido === ev._id}
                        onChange={() => setElegido(ev._id)}
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="flex-1 text-sm">
                        <span className="font-medium text-gray-900">{formatDateTime(ev.fechaEvento)}</span>
                        <span className="text-gray-600"> · {ev.advisorNombre || 'Sin guía'}</span>
                      </span>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        lleno ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {ev.inscritos}/{ev.limiteUsuarios || '∞'}{lleno ? ' · LLENO' : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={guardando}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => confirmar()}
              disabled={!elegido || guardando}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando…' : accion}
            </button>
          </div>
        </div>
      </div>

      {/* Sesión llena: se autoriza el sobrecupo o se elige otro horario */}
      {sobrecupo && (
        <SobrecupoModal
          detalle={sobrecupo}
          puedeAutorizar={puedeAutorizarSobrecupo}
          procesando={guardando}
          onCancel={() => setSobrecupo(null)}
          onConfirm={() => { setSobrecupo(null); confirmar(true) }}
        />
      )}
    </>
  )
}
