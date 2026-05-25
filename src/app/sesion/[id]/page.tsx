'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { CalendarIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import SessionTabs from '@/components/session/SessionTabs'
import SessionGeneralTab from '@/components/session/SessionGeneralTab'
import SessionStudentsTab from '@/components/session/SessionStudentsTab'
import SessionMaterialTab from '@/components/session/SessionMaterialTab'
import SessionAdvisorMaterialTab from '@/components/session/SessionAdvisorMaterialTab'

interface CalendarioEvent {
  _id: string
  nombreEvento: string
  evento: 'SESSION' | 'CLUB' | 'WELCOME'
  dia: string
  advisor: string
  tituloONivel: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
  nivel?: string
  step?: string
  // Ctrl Horas
  timeout?: string | null
  notasadvisor?: string | null
  sesionCerrada?: boolean
  fechaCierreSesion?: string | null
}

interface Student {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  email?: string
  celular?: string
  plataforma?: string
  edad?: number
  pais?: string
  hobbies?: string
  foto?: string
  nivel?: string
  step?: string
}

interface ClassRecord {
  _id: string
  idEstudiante: string
  idEvento: string
  asistencia: boolean
  participacion: boolean
  noAprobo?: boolean
  calificacion?: string
  comentarios?: string
  advisorAnotaciones?: string
  actividadPropuesta?: string
  nivel?: string
  step?: string
}

interface StudentWithClass extends Student {
  pruebainter?: string | null
  classRecord?: ClassRecord
}

export default function SesionPage() {
  const params = useParams()
  const router = useRouter()
  const eventoId = params.id as string

  const [loading, setLoading] = useState(true)
  const [evento, setEvento] = useState<CalendarioEvent | null>(null)
  const [students, setStudents] = useState<StudentWithClass[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentWithClass | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (eventoId) {
      loadEventoData()
    }
  }, [eventoId])

  const loadEventoData = async () => {
    try {
      setLoading(true)

      // Cargar datos del evento
      const eventoResponse = await fetch(`/api/postgres/events/${eventoId}`)
      if (!eventoResponse.ok) throw new Error('Error al cargar evento')

      const eventoData = await eventoResponse.json()
      if (!eventoData.success) throw new Error(eventoData.error)

      setEvento(eventoData.event)

      // Cargar estudiantes inscritos
      await loadStudents()

    } catch (err) {
      console.error('Error loading evento:', err)
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const loadStudents = async () => {
    try {
      // Obtener bookings del evento
      const bookingsResponse = await fetch(`/api/postgres/events/${eventoId}/bookings?includeStudent=true`)

      if (!bookingsResponse.ok) throw new Error('Error al cargar estudiantes')

      const bookingsData = await bookingsResponse.json()

      if (bookingsData.success && bookingsData.bookings) {
        // Map integer calificacion back to text labels for the dropdown
        const calificacionReverseMap: Record<number, string> = {
          10: 'Excelente', 8: 'Muy Bien', 6: 'Bien', 4: 'Regular', 2: 'Necesita Mejorar',
        }

        const studentsWithClasses: StudentWithClass[] = bookingsData.bookings.map((booking: any) => {
          const calNum = typeof booking.calificacion === 'number' ? booking.calificacion : parseInt(booking.calificacion)
          const calText = !isNaN(calNum) ? (calificacionReverseMap[calNum] || String(calNum)) : (booking.calificacion || '')

          return {
            _id: booking.idEstudiante,
            primerNombre: booking.primerNombre,
            primerApellido: booking.primerApellido,
            email: booking.email,
            plataforma: booking.plataforma,
            edad: booking.edad,
            pais: booking.pais,
            hobbies: booking.hobbies || '',
            pruebainter: booking.studentPruebaInter ?? null,
            classRecord: {
              _id: booking._id,
              idEstudiante: booking.idEstudiante,
              idEvento: booking.eventoId || booking.idEvento,
              asistencia: booking.asistio ?? booking.asistencia ?? false,
              participacion: booking.participacion ?? false,
              noAprobo: booking.noAprobo ?? false,
              calificacion: calText,
              comentarios: booking.comentarios || '',
              advisorAnotaciones: booking.advisorAnotaciones || '',
              actividadPropuesta: booking.actividadPropuesta || '',
              nivel: booking.nivel,
              step: booking.step,
            },
          }
        })

        setStudents(studentsWithClasses)

        // Update selectedStudent if it exists so the form reflects saved data
        if (selectedStudent) {
          const updated = studentsWithClasses.find((s: StudentWithClass) => s._id === selectedStudent._id)
          if (updated) setSelectedStudent(updated)
        }
      }
    } catch (err) {
      console.error('Error loading students:', err)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando sesión...</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !evento) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">{error || 'Evento no encontrado'}</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.IR_A_SESION}>
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900">
                  {evento.tituloONivel} - {evento.nombreEvento}
                </h1>
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <CalendarIcon className="h-4 w-4" />
                    <span>{format(new Date(evento.dia), "EEEE, d 'de' MMMM", { locale: es })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ClockIcon className="h-4 w-4" />
                    <span>{format(new Date(evento.dia), 'HH:mm', { locale: es })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <UserGroupIcon className="h-4 w-4" />
                    <span>{students.length} / {evento.limiteUsuarios} estudiantes</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {evento.linkZoom && (
                  <a
                    href={evento.linkZoom}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Ir a Zoom
                  </a>
                )}
                <RegistrarSesionButton
                  evento={evento}
                  onClosed={() => loadEventoData()}
                />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <SessionTabs>
            {{
              general: (
                <SessionGeneralTab
                  evento={evento}
                  studentCount={students.length}
                />
              ),
              students: (
                <SessionStudentsTab
                  evento={evento}
                  students={students}
                  selectedStudent={selectedStudent}
                  onStudentSelect={setSelectedStudent}
                  onDataUpdate={loadStudents}
                />
              ),
              material: (
                <SessionMaterialTab
                  eventoNombre={evento.nombreEvento}
                />
              ),
              advisorMaterial: (
                <SessionAdvisorMaterialTab
                  step={evento.step || ''}
                  nivel={evento.nivel || ''}
                />
              )
            }}
          </SessionTabs>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}

/**
 * Botón "Registrar Sesión" (Ctrl Horas):
 * - Solo visible para el advisor asignado al evento (matcheado por email).
 * - Solo habilitado si NOW >= fechaEvento + 30 min.
 * - Pide Time Out (requerido HH:MM) y Notas (opcional, default "no hubo novedades").
 * - Aviso suave con confirm() al salir de la página si el flag está activo.
 */
function RegistrarSesionButton({
  evento,
  onClosed,
}: {
  evento: CalendarioEvent
  onClosed: () => void
}) {
  const { data: session } = useSession()
  const role = (session?.user as any)?.role
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN'

  const [isMyEvent, setIsMyEvent] = useState(false)
  const [requiereRegistro, setRequiereRegistro] = useState(true)
  const [open, setOpen] = useState(false)
  const [timeoutVal, setTimeoutVal] = useState(evento.timeout || '')
  const [notas, setNotas] = useState(evento.notasadvisor || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Resolver si el usuario logueado es el advisor del evento
  useEffect(() => {
    const email = (session?.user as any)?.email
    if (!email) return
    fetch(`/api/postgres/advisors/by-email/${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(j => {
        const myId = j.advisor?._id
        setIsMyEvent(!!myId && myId === evento.advisor)
      })
      .catch(() => setIsMyEvent(false))
    fetch(`/api/postgres/config/sesion-requiere-registro`)
      .then(r => r.json())
      .then(j => setRequiereRegistro(j.value !== false && j.value !== 'false'))
      .catch(() => { /* mantener default true */ })
  }, [session, evento.advisor])

  // Aviso suave al salir sin cerrar (cuando aplique)
  useEffect(() => {
    if (!isMyEvent || evento.sesionCerrada || !requiereRegistro) return
    const eventStart = new Date(evento.dia).getTime()
    if (Date.now() < eventStart + 30 * 60 * 1000) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = 'Hay datos sin guardar de la sesión. ¿Salir igual?'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isMyEvent, evento.sesionCerrada, evento.dia, requiereRegistro])

  if (isAdmin || !isMyEvent) return null

  const eventStart = new Date(evento.dia).getTime()
  const elapsedMin = (Date.now() - eventStart) / 60000
  const canRegister = elapsedMin >= 30

  if (evento.sesionCerrada) {
    return (
      <span className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg">
        ✓ Sesión registrada
      </span>
    )
  }

  if (!canRegister) {
    return (
      <span className="px-3 py-2 text-xs text-gray-500 italic" title="Disponible 30 min después del inicio">
        Registro disponible en {Math.max(0, Math.ceil(30 - elapsedMin))} min
      </span>
    )
  }

  const TIMEOUT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

  async function submitClose() {
    if (!TIMEOUT_REGEX.test(timeoutVal)) {
      setErr('Time Out debe estar en formato HH:MM militar (ej. 09:30)')
      return
    }
    setSaving(true); setErr(null)
    try {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' } catch { return 'America/Bogota' } })()
      // 1. Guardar timeout y notas
      const patchRes = await fetch(`/api/postgres/calendario/${evento._id}/notas-advisor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: timeoutVal, notasadvisor: notas || null, tz }),
      })
      const patchJson = await patchRes.json()
      if (!patchRes.ok || !patchJson.success) throw new Error(patchJson.error || 'Error guardando notas')

      // 2. Cerrar sesión
      const closeRes = await fetch(`/api/postgres/calendario/${evento._id}/cerrar-sesion`, { method: 'POST' })
      const closeJson = await closeRes.json()
      if (!closeRes.ok || !closeJson.success) throw new Error(closeJson.error || 'Error cerrando sesión')

      toast.success('Sesión registrada correctamente')
      setOpen(false)
      onClosed()
    } catch (e: any) {
      setErr(e?.message || 'Error inesperado')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Auto-llenar timeout con la hora actual del navegador al abrir
          // (el advisor puede ajustar si cerró tarde).
          if (!timeoutVal) {
            const now = new Date()
            const hh = String(now.getHours()).padStart(2, '0')
            const mm = String(now.getMinutes()).padStart(2, '0')
            setTimeoutVal(`${hh}:${mm}`)
          }
          setOpen(true); setErr(null)
        }}
        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-semibold"
      >
        Registrar Sesión
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Registrar Sesión</h3>
            <p className="text-sm text-gray-600 mb-4">
              Esta acción cierra la sesión y la marca como atendida. No podrás editar
              Time Out ni Notas después de cerrar.
            </p>

            <div className="mb-3">
              <label htmlFor="timeout-input" className="block text-xs font-medium text-gray-700 mb-1">
                Time Out (HH:MM militar) <span className="text-red-600">*</span>
              </label>
              <input
                id="timeout-input"
                type="time"
                value={timeoutVal}
                onChange={e => setTimeoutVal(e.target.value)}
                required
                className="w-32 border border-gray-300 rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="notas-input" className="block text-xs font-medium text-gray-700 mb-1">
                Notas (opcional)
              </label>
              <textarea
                id="notas-input"
                value={notas}
                onChange={e => setNotas(e.target.value)}
                rows={3}
                placeholder='Si dejas vacío se guarda "no hubo novedades"'
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>

            {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitClose}
                disabled={saving || !timeoutVal}
                className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Confirmar Registro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
