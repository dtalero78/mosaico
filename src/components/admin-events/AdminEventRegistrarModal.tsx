'use client'

/**
 * Modal de detalle + registro de un Admin Event.
 *
 * La ventana ESCALA con la duración nominal (`event.horas`):
 *   - Antes del fin nominal           → info + countdown "Disponible en N min"
 *   - Entre fin nominal y +90 min     → input Time Out + Notas + botón "Registrar"
 *   - Después de fin + 90 min         → "Período vencido — Coordinador"
 *   - Coordinador (cualquier momento) → siempre puede registrar (bypass)
 *   - Ya registrado                   → solo info (Time Out + Notas read-only +
 *                                        badge "Por Coordinación" si aplica)
 *
 * El timeout se auto-llena con la HORA DE FIN NOMINAL (no la hora actual)
 * para reflejar la duración cobrada al advisor. El advisor puede editar.
 */
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import { XMarkIcon, ClockIcon } from '@heroicons/react/24/outline'
import {
  getAdminEventWindow,
  ADMIN_EVENT_TIPO_META,
  ADMIN_EVENT_EXPIRED_MESSAGE,
  type AdminEventTipo,
} from '@/lib/admin-event-window'

interface AdminEventDetail {
  _id: string
  tipo: AdminEventTipo
  titulo: string | null
  descripcion: string | null
  fechaInicio: string
  horas: number
  registrado: boolean
  fechaRegistro: string | null
  timeout: string | null
  notas: string | null
  motivoCierre: string | null
}

const TIMEOUT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export default function AdminEventRegistrarModal({
  event, onClose, onSaved,
}: {
  event: AdminEventDetail
  onClose: () => void
  onSaved: () => void
}) {
  const { data: session } = useSession()
  const role = String((session?.user as any)?.role || '').toUpperCase()

  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const ws = getAdminEventWindow(event.fechaInicio, role, now, event.horas)

  // Hora de fin nominal en formato HH:MM local (sirve para auto-llenado
  // del timeout y para mostrar mensajes "termina a las HH:MM").
  const finNominalHHMM = (() => {
    const start = new Date(event.fechaInicio)
    const end = new Date(start.getTime() + event.horas * 60 * 60_000)
    return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
  })()

  const [timeout, setTimeoutVal] = useState(event.timeout || '')
  const [notas, setNotas]         = useState(event.notas || '')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  // Auto-llenar timeout con HORA DE FIN NOMINAL al abrir si está vacío y se
  // puede registrar. Refleja la duración cobrada al advisor (no la hora
  // actual del navegador). El advisor puede editar si cerró más tarde.
  useEffect(() => {
    if (!event.registrado && !timeout && ws.canRegister) {
      setTimeoutVal(finNominalHHMM)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event._id])

  const meta = ADMIN_EVENT_TIPO_META[event.tipo]
  const startDate = new Date(event.fechaInicio)
  const fechaFmt = startDate.toLocaleString('es', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  async function submitRegistrar() {
    if (!TIMEOUT_REGEX.test(timeout)) {
      setErr('Time Out debe estar en formato HH:MM militar (ej. 09:30)')
      return
    }
    setSaving(true); setErr(null)
    try {
      const r = await fetch(`/api/postgres/admin-events/${event._id}/registrar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout, notas: notas || null }),
      })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      toast.success('Evento administrativo registrado')
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Error al registrar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl my-8">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${meta.color}`}>
              <ClockIcon className={`h-6 w-6 ${meta.textColor}`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {meta.label}
                {event.registrado && (
                  event.motivoCierre === 'GESTION_COORDINADOR' ? (
                    <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                      ✓ Por Coordinación
                    </span>
                  ) : (
                    <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                      ✓ Registrado
                    </span>
                  )
                )}
              </h2>
              <p className="text-xs text-gray-500 capitalize">{fechaFmt} · {event.horas}h</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving}
            className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Info detalle */}
        <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1 mb-4 border border-gray-200">
          {event.titulo && <div><strong>Título:</strong> {event.titulo}</div>}
          {event.descripcion && <div><strong>Descripción:</strong> {event.descripcion}</div>}
          {event.registrado && event.timeout && (
            <div><strong>Time Out:</strong> {event.timeout}</div>
          )}
          {event.registrado && event.notas && (
            <div><strong>Notas:</strong> {event.notas}</div>
          )}
        </div>

        {/* Estado de ventana — solo si NO registrado */}
        {!event.registrado && (
          <>
            {ws.isCoordinator && ws.minutesElapsed > ws.finNominalMin + 90 ? (
              <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-3 mb-4 text-sm text-blue-900">
                <strong>Gestionando como Coordinador</strong>: la ventana del advisor venció (
                {ws.minutesElapsed} min desde el inicio). Quedará con motivo
                <code className="mx-1 bg-blue-100 px-1 rounded">GESTION_COORDINADOR</code>.
              </div>
            ) : ws.isExpired ? (
              <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-lg p-3 mb-4 text-sm text-amber-900">
                {ADMIN_EVENT_EXPIRED_MESSAGE}
              </div>
            ) : !ws.canRegister && ws.minutesUntilRegister !== null ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-900">
                El evento dura {event.horas}h — termina a las <strong>{finNominalHHMM}</strong>.
                {' '}Registro disponible en {ws.minutesUntilRegister} min.
              </div>
            ) : null}

            {/* Inputs solo si puede registrar */}
            {ws.canRegister && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="ae-timeout" className="block text-xs font-medium text-gray-700 mb-1">
                    Time Out (HH:MM) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="ae-timeout"
                    type="time"
                    value={timeout}
                    onChange={e => setTimeoutVal(e.target.value)}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Pre-llenado con la hora de fin nominal ({finNominalHHMM}).
                    {!ws.isCoordinator && <> No puede ser anterior.</>}
                  </p>
                </div>
                <div>
                  <label htmlFor="ae-notas" className="block text-xs font-medium text-gray-700 mb-1">
                    Notas (opcional)
                  </label>
                  <textarea
                    id="ae-notas"
                    rows={3}
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                    placeholder='Si dejas vacío se guarda "no hubo novedades"'
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>

                {err && <div className="text-sm text-red-600">{err}</div>}
              </div>
            )}
          </>
        )}

        {/* Acciones */}
        <div className="mt-5 flex justify-end gap-2 pt-3 border-t border-gray-100">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cerrar
          </button>
          {!event.registrado && ws.canRegister && (
            <button type="button" onClick={submitRegistrar} disabled={saving || !timeout}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Registrando…' : '✓ Registrar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
