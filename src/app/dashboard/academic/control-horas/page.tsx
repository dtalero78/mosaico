'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface VigenteRow {
  source: 'CALENDARIO'
  eventoId: string
  fechaEvento: string
  horaInicio: string | null
  tipo: string | null
  nivel: string | null
  step: string | null
  tituloEvento: string | null
  observacionesEvento: string | null
  timeout: string | null
  notasadvisor: string | null
  sesionCerrada: boolean
  fechaCierreSesion: string | null
  inscritos: number
  asistieron: number
  absent: number
  estado: 'Conducted'
  canEdit: boolean
  editReason: string | null
}

interface HistoricoRow {
  source: 'LOG'
  logId: string
  eventoId: string
  fechaEvento: string
  horaInicio: string | null
  tipo: string | null
  nivel: string | null
  step: string | null
  tituloEvento: string | null
  timeout: string | null
  notasadvisor: string | null
  estado: 'Canceled' | 'Suspended'
  canceladoPor: string
  fechaTransicion: string
  motivoTransicion: string | null
}

interface AdvisorOption {
  _id: string
  nombre: string
  email: string
  primerNombre?: string
  primerApellido?: string
  fotoAdvisor?: string | null
}

type EventCard =
  | (VigenteRow & { kind: 'vigente' })
  | (HistoricoRow & { kind: 'historico' })

const WEEKDAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/**
 * Extrae "HH:MM" desde un ISO timestamp en la zona horaria del navegador.
 * CALENDARIO.dia es la única fuente de verdad — CALENDARIO.hora es un string
 * legacy que en datos históricos quedó guardado como hora UTC (no local) y
 * NO se debe usar para mostrar.
 */
function formatHoraLocal(iso: string | null | undefined): string {
  if (!iso) return '--:--'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return '--:--'
  }
}

/** TZ del navegador, usada para pasar al backend en validaciones server-side. */
function clientTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' }
  catch { return 'America/Bogota' }
}

export default function ControlHorasPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.CONTROL_HORAS_VER} showDefaultMessage>
        <ControlHorasContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function ControlHorasContent() {
  const { data: session } = useSession()
  const { hasPermission } = usePermissions()
  const role = (session?.user as any)?.role as string | undefined
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN'
  const myEmail = (session?.user as any)?.email as string | undefined
  // Puede seleccionar/consultar el Ctrl Horas de CUALQUIER advisor:
  // SUPER_ADMIN/ADMIN (implícito) o cualquier rol con el permiso explícito.
  const canPickAdvisor = isAdmin || hasPermission(AcademicoPermission.CONTROL_HORAS_VER_TODOS)

  const [advisorId, setAdvisorId] = useState<string>('')
  const [advisors, setAdvisors] = useState<AdvisorOption[]>([])

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{ vigentes: VigenteRow[]; historicos: HistoricoRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedCard, setSelectedCard] = useState<EventCard | null>(null)

  // Caché client por (advisor, año, mes). Evita refetch al navegar adelante/atrás
  // entre meses ya consultados en la misma sesión. Se invalida sólo en:
  //   - botón Recargar (fetchMonth(true))
  //   - save de notas (cacheRef.current.delete(key)) para que la próxima carga
  //     traiga datos frescos en caso de que cambie algo en el backend (audit).
  const cacheRef = useRef(new Map<string, { vigentes: VigenteRow[]; historicos: HistoricoRow[] }>())

  // Info del advisor actualmente seleccionado (para el header con foto + nombre).
  // Admin: se deriva de `advisors` cuando cambia advisorId.
  // ADVISOR: se obtiene del fetch by-email.
  const [currentAdvisor, setCurrentAdvisor] = useState<AdvisorOption | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!myEmail) return
    if (canPickAdvisor) {
      fetch('/api/postgres/advisors')
        .then(r => r.json())
        .then(j => {
          const list: AdvisorOption[] = (j.advisors || j.data || []).map((a: any) => ({
            _id: a._id,
            nombre: `${a.primerNombre ?? ''} ${a.primerApellido ?? ''}`.trim() || a.email,
            email: a.email,
            primerNombre: a.primerNombre,
            primerApellido: a.primerApellido,
            fotoAdvisor: a.fotoAdvisor ?? null,
          }))
          setAdvisors(list)
          if (list[0]) setAdvisorId(list[0]._id)
        })
        .catch(() => { /* ignore */ })
    } else {
      fetch(`/api/postgres/advisors/by-email/${encodeURIComponent(myEmail)}`)
        .then(r => r.json())
        .then(j => {
          const a = j.advisor
          if (a?._id) {
            setAdvisorId(a._id)
            setCurrentAdvisor({
              _id: a._id,
              nombre: `${a.primerNombre ?? ''} ${a.primerApellido ?? ''}`.trim() || a.email,
              email: a.email,
              primerNombre: a.primerNombre,
              primerApellido: a.primerApellido,
              fotoAdvisor: a.fotoAdvisor ?? null,
            })
          } else {
            setError('Tu usuario no está registrado como advisor')
          }
        })
        .catch(() => setError('No se pudo cargar tu perfil de advisor'))
    }
  }, [myEmail, canPickAdvisor])

  // Mantener currentAdvisor sincronizado con advisorId cuando se cambia
  // de selección desde el dropdown.
  useEffect(() => {
    if (!canPickAdvisor || !advisorId) return
    const found = advisors.find(a => a._id === advisorId)
    if (found) setCurrentAdvisor(found)
  }, [advisorId, advisors, canPickAdvisor])

  // Cargar presigned URL de la foto cuando cambia el advisor seleccionado.
  useEffect(() => {
    setFotoUrl(null)
    const key = currentAdvisor?.fotoAdvisor
    if (!key) return
    fetch(`/api/postgres/materials/presigned?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(d => { if (d.signedUrl) setFotoUrl(d.signedUrl) })
      .catch(() => { /* fallback a inicial */ })
  }, [currentAdvisor?.fotoAdvisor])

  const fetchMonth = useCallback(async (force = false) => {
    if (!advisorId) return
    const key = `${advisorId}-${year}-${month}`
    if (!force) {
      const cached = cacheRef.current.get(key)
      if (cached) {
        setData(cached)
        setLoading(false)
        setError(null)
        return
      }
    }
    setLoading(true); setError(null)
    try {
      const res = await fetch(
        `/api/postgres/advisors/${advisorId}/control-horas?year=${year}&month=${month}`,
        { cache: 'no-store' },
      )
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error cargando datos')
      const fresh = { vigentes: json.vigentes ?? [], historicos: json.historicos ?? [] }
      cacheRef.current.set(key, fresh)
      setData(fresh)
    } catch (err: any) {
      setError(err?.message || 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [advisorId, year, month])

  useEffect(() => { if (advisorId) fetchMonth() }, [advisorId, fetchMonth])

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  // Agrupar cards por día del mes (key = "YYYY-MM-DD" en TZ del cliente)
  const cardsByDay = useMemo(() => {
    const m = new Map<string, EventCard[]>()
    if (!data) return m
    const push = (c: EventCard) => {
      const d = new Date(c.fechaEvento)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const arr = m.get(key) ?? []
      arr.push(c)
      m.set(key, arr)
    }
    data.vigentes.forEach(v => push({ ...v, kind: 'vigente' }))
    data.historicos.forEach(h => push({ ...h, kind: 'historico' }))
    // Ordenar cada día por hora
    m.forEach((arr, k) => arr.sort((a, b) =>
      formatHoraLocal(a.fechaEvento).localeCompare(formatHoraLocal(b.fechaEvento))
    ))
    return m
  }, [data])

  // Totales del mes — por tipo (vigentes + históricos), por estado, y registro.
  // effective + sinRegistrar = conducted (las 2 caras de la misma moneda).
  const totales = useMemo(() => {
    const t = {
      sessions: 0, clubs: 0, welcome: 0,
      conducted: 0, canceled: 0, suspended: 0,
      effective: 0, sinRegistrar: 0,
    }
    if (!data) return t
    const countByTipo = (tipo: string | null) => {
      switch ((tipo || '').toUpperCase()) {
        case 'SESSION': t.sessions++; break
        case 'CLUB':    t.clubs++; break
        case 'WELCOME': t.welcome++; break
      }
    }
    data.vigentes.forEach(v => {
      countByTipo(v.tipo)
      t.conducted++
      if (v.sesionCerrada === true) t.effective++
      else                          t.sinRegistrar++
    })
    data.historicos.forEach(h => {
      countByTipo(h.tipo)
      if (h.estado === 'Canceled')  t.canceled++
      if (h.estado === 'Suspended') t.suspended++
    })
    return t
  }, [data])

  // Build calendar grid: filas x 7 columnas (Lun-Dom)
  const calendarCells = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1)
    const daysInMonth = new Date(year, month, 0).getDate()
    // En JS: getDay() 0=Dom, 1=Lun, ..., 6=Sáb. Convertimos a 0=Lun, 6=Dom
    const offset = (firstDay.getDay() + 6) % 7
    const cells: Array<{ day: number | null; key: string }> = []
    for (let i = 0; i < offset; i++) cells.push({ day: null, key: `empty-${i}` })
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ day: d, key })
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, key: `empty-end-${cells.length}` })
    return cells
  }, [year, month])

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header adaptativo según rol:
          - ADVISOR (su propio panel): "¡Hola {nombre}!" + subtítulo "⏰ Control de Horas"
          - Admin (consulta a otro):    "⏰ Control de Horas" + subtítulo con nombre advisor */}
      <div className="mb-6 flex items-center gap-4">
        <AdvisorAvatar
          fotoUrl={fotoUrl}
          inicial={currentAdvisor?.primerNombre?.[0]?.toUpperCase() || 'A'}
        />
        <div>
          {role === 'ADVISOR' ? (
            <>
              <h1 className="text-2xl font-bold text-gray-900">
                ¡Hola {currentAdvisor?.primerNombre || ''}!
              </h1>
              <p className="mt-1 text-sm text-gray-600 flex items-center gap-1.5">
                <ClockIcon className="h-4 w-4 text-blue-600" />
                Control de Horas
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <ClockIcon className="h-7 w-7 text-blue-600" />
                Control de Horas
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                {currentAdvisor
                  ? `${currentAdvisor.primerNombre ?? ''} ${currentAdvisor.primerApellido ?? ''}`.trim() || currentAdvisor.email
                  : 'Selecciona un advisor'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        {canPickAdvisor && (
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="advisor-select" className="block text-xs font-medium text-gray-700 mb-1">Advisor</label>
            <select
              id="advisor-select"
              value={advisorId}
              onChange={e => setAdvisorId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            >
              {advisors.map(a => <option key={a._id} value={a._id}>{a.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => changeMonth(-1)} title="Mes anterior"
            className="p-2 border border-gray-300 rounded hover:bg-gray-50">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="text-base font-semibold text-gray-800 px-3 capitalize">
            {new Date(year, month - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })}
          </div>
          <button type="button" onClick={() => changeMonth(1)} title="Mes siguiente"
            className="p-2 border border-gray-300 rounded hover:bg-gray-50">
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={() => fetchMonth(true)} disabled={!advisorId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-600 text-sm font-medium rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50">
          <ArrowPathIcon className="h-4 w-4" /> Recargar
        </button>

        {/* Leyenda de colores */}
        <div className="flex items-center gap-3 ml-auto flex-wrap text-xs text-gray-600">
          <LegendDot color="bg-blue-500"   label="SESSION" />
          <LegendDot color="bg-green-500"  label="CLUB" />
          <LegendDot color="bg-purple-500" label="WELCOME" />
          <LegendDot color="bg-yellow-500" label="Suspended" />
          <LegendDot color="bg-red-500"    label="Canceled" />
        </div>
      </div>

      {/* Tarjetas destacadas: Effective vs sin Registrar (cara registro) */}
      {data && !loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <TotalCard label="Effective Hours"        value={totales.effective}    color="bg-emerald-50 border-emerald-400 text-emerald-700" />
          <TotalCard label="Hours without recording" value={totales.sinRegistrar} color="bg-amber-50   border-amber-400   text-amber-700" />
        </div>
      )}

      {/* Tarjetas de totales del mes */}
      {data && !loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-4">
          <TotalCard label="Sessions"  value={totales.sessions}  color="bg-blue-50  border-blue-300  text-blue-700" />
          <TotalCard label="Clubs"     value={totales.clubs}     color="bg-green-50 border-green-300 text-green-700" />
          <TotalCard label="Welcome"   value={totales.welcome}   color="bg-purple-50 border-purple-300 text-purple-700" />
          <TotalCard label="Conducted" value={totales.conducted} color="bg-sky-50   border-sky-300   text-sky-700" />
          <TotalCard label="Canceled"  value={totales.canceled}  color="bg-red-50   border-red-300   text-red-700" />
          <TotalCard label="Suspended" value={totales.suspended} color="bg-yellow-50 border-yellow-300 text-yellow-800" />
        </div>
      )}

      {/* Calendario o estados */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          Cargando…
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">{error}</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Header de días */}
          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {WEEKDAYS_ES.map(d => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-700">{d}</div>
            ))}
          </div>
          {/* Grid de celdas */}
          <div className="grid grid-cols-7">
            {calendarCells.map(cell => {
              if (cell.day === null) {
                return <div key={cell.key} className="min-h-[110px] bg-gray-50 border-r border-b border-gray-100" />
              }
              const cards = cardsByDay.get(cell.key) ?? []
              const isToday = cell.key === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
              return (
                <div key={cell.key} className={`min-h-[110px] p-1.5 border-r border-b border-gray-100 ${isToday ? 'bg-blue-50/40' : 'bg-white'}`}>
                  <div className={`text-xs font-semibold mb-1 ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>{cell.day}</div>
                  <div className="space-y-1">
                    {cards.map(c => (
                      <button
                        key={c.kind === 'vigente' ? c.eventoId : `${c.eventoId}_${c.logId}`}
                        type="button"
                        onClick={() => setSelectedCard(c)}
                        title={`${c.tipo ?? ''} ${c.nivel ?? ''} ${c.step ?? ''} · ${stateLabel(c)}`}
                        className={`block w-full text-left px-1.5 py-1 rounded text-[11px] font-medium ${colorClass(c)} hover:opacity-90 transition`}
                      >
                        <div className="truncate">
                          {formatHoraLocal(c.fechaEvento)} - {c.nivel || ''} {c.step ? `· ${c.step}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal de detalle del evento */}
      {selectedCard && (
        <EventDetailModal
          card={selectedCard}
          // ADVISOR propio: puede editar sólo vigentes dentro de la ventana temporal.
          // ADMIN/SUPER_ADMIN: puede editar SIEMPRE eventos vigentes (vigente=Conducted),
          // pero si la sesión está cerrada se pedirá motivo en el modal de warning.
          // Históricos (Canceled/Suspended) siempre son read-only.
          canEditNotes={selectedCard.kind === 'vigente' && (isAdmin || selectedCard.canEdit)}
          isAdminEditor={isAdmin}
          onClose={() => setSelectedCard(null)}
          // Optimistic update: en vez de refetch el mes entero (~150 eventos),
          // mutamos sólo el evento editado con la respuesta del PATCH. Invalidamos
          // la entrada de caché de este mes para que la próxima navegación traiga
          // datos frescos (incluye estados como `sesionCerrada` que vienen del DB).
          onSaved={(updated) => {
            if (selectedCard.kind !== 'vigente') return
            const evId = selectedCard.eventoId
            setData(prev => {
              if (!prev) return prev
              return {
                ...prev,
                vigentes: prev.vigentes.map(v =>
                  v.eventoId === evId
                    ? { ...v, timeout: updated.timeout, notasadvisor: updated.notasadvisor }
                    : v
                ),
              }
            })
            cacheRef.current.delete(`${advisorId}-${year}-${month}`)
            setSelectedCard(prev =>
              prev && prev.kind === 'vigente' && prev.eventoId === evId
                ? { ...prev, timeout: updated.timeout, notasadvisor: updated.notasadvisor }
                : prev
            )
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────

function AdvisorAvatar({ fotoUrl, inicial }: { fotoUrl: string | null; inicial: string }) {
  return (
    <div className="flex-shrink-0 w-16 h-16 rounded-full overflow-hidden bg-gray-100 border-2 border-blue-200">
      {fotoUrl
        ? <img src={fotoUrl} alt="Foto advisor" className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center bg-blue-100">
            <span className="text-2xl font-bold text-blue-600">{inicial}</span>
          </div>
      }
    </div>
  )
}

function TotalCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`${color} border rounded-lg px-3 py-2 text-center`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide font-semibold">{label}</div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-3 h-3 rounded ${color}`} />
      {label}
    </span>
  )
}

/**
 * Color del bloque según estado + tipo.
 * Estado tiene prioridad: Canceled rojo, Suspended amarillo.
 * Vigentes por tipo: SESSION azul, CLUB verde, WELCOME morado.
 */
function colorClass(c: EventCard): string {
  if (c.kind === 'historico') {
    if (c.estado === 'Canceled') return 'bg-red-500 text-white'
    if (c.estado === 'Suspended') return 'bg-yellow-500 text-yellow-900'
  }
  switch ((c.tipo || '').toUpperCase()) {
    case 'SESSION': return 'bg-blue-500 text-white'
    case 'CLUB':    return 'bg-green-500 text-white'
    case 'WELCOME': return 'bg-purple-500 text-white'
    default:        return 'bg-gray-400 text-white'
  }
}

function stateLabel(c: EventCard): string {
  if (c.kind === 'historico') return c.estado
  return c.sesionCerrada ? 'Cerrada' : 'Conducted'
}

// ─────────────────────────────────────────────────────────

function EventDetailModal({
  card, canEditNotes, isAdminEditor, onClose, onSaved,
}: {
  card: EventCard
  canEditNotes: boolean
  isAdminEditor: boolean
  onClose: () => void
  /** Recibe los valores actualizados devueltos por el PATCH para que el padre
   *  haga optimistic update sin refetch. */
  onSaved: (updated: { timeout: string | null; notasadvisor: string | null }) => void
}) {
  const isHistorical = card.kind === 'historico'
  const [editing, setEditing] = useState(false)
  const [timeoutVal, setTimeoutVal] = useState(card.timeout || '')
  const [notas, setNotas] = useState(card.notasadvisor || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Estado del modal de warning para admin editando sesión cerrada
  const [showClosedWarning, setShowClosedWarning] = useState(false)
  const [warningChecked, setWarningChecked] = useState(false)
  const [adminMotivo, setAdminMotivo] = useState('')

  // Sincronizar estado interno si llega un card nuevo desde el padre
  useEffect(() => {
    setTimeoutVal(card.timeout || '')
    setNotas(card.notasadvisor || '')
    setEditing(false)
    setErr(null)
    setShowClosedWarning(false)
    setWarningChecked(false)
    setAdminMotivo('')
  }, [card])

  const fecha = new Date(card.fechaEvento)
  const fechaStr = fecha.toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  const agend = card.kind === 'vigente' ? card.inscritos : 0
  const attend = card.kind === 'vigente' ? card.asistieron : 0
  const absen = card.kind === 'vigente' ? card.absent : 0
  const isClosed = card.kind === 'vigente' && card.sesionCerrada

  // Color del header del modal — mismo criterio del bloque
  const headerColorClass = (() => {
    if (isHistorical) {
      if (card.estado === 'Canceled') return 'bg-red-500 text-white'
      if (card.estado === 'Suspended') return 'bg-yellow-500 text-yellow-900'
    }
    switch ((card.tipo || '').toUpperCase()) {
      case 'SESSION': return 'bg-blue-500 text-white'
      case 'CLUB':    return 'bg-green-500 text-white'
      case 'WELCOME': return 'bg-purple-500 text-white'
      default:        return 'bg-gray-500 text-white'
    }
  })()

  /**
   * Inicia la edición. Si la sesión está cerrada Y el editor es admin,
   * primero muestra el warning con motivo obligatorio.
   */
  function startEdit() {
    if (isAdminEditor && isClosed) {
      setShowClosedWarning(true)
      setWarningChecked(false)
      setAdminMotivo('')
      return
    }
    setEditing(true)
  }

  function confirmAdminEdit() {
    if (!warningChecked || !adminMotivo.trim()) return
    setShowClosedWarning(false)
    setEditing(true)
  }

  async function save() {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`/api/postgres/calendario/${(card as VigenteRow).eventoId}/notas-advisor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeout: timeoutVal || null,
          notasadvisor: notas || null,
          tz: clientTimeZone(),
          // Sólo se envía si admin está editando una sesión ya cerrada.
          // El backend exige este motivo cuando isClosed && isAdmin.
          ...(isAdminEditor && isClosed && adminMotivo.trim() ? { motivoAdminEdit: adminMotivo.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error guardando')
      toast.success(json.audited ? 'Guardado (con registro de auditoría)' : 'Guardado')
      setEditing(false)
      setAdminMotivo('')
      // El backend devuelve los valores ya normalizados (después de validar/strip).
      // El padre los usa para optimistic update sin refetch del mes entero.
      onSaved({
        timeout: json.timeout ?? null,
        notasadvisor: json.notasadvisor ?? null,
      })
    } catch (e: any) {
      setErr(e?.message || 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header con color del estado/tipo */}
        <div className={`${headerColorClass} px-6 py-4 rounded-t-lg flex items-start justify-between`}>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-90">{stateLabel(card)}</div>
            <div className="text-lg font-bold mt-0.5">
              {formatHoraLocal(card.fechaEvento)} · {card.nivel || ''} {card.step ? `· ${card.step}` : ''} · {card.tipo || ''}
            </div>
            <div className="text-sm opacity-90 capitalize">{fechaStr}</div>
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="opacity-90 hover:opacity-100">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <DataBlock label="Time">
              <div className="text-[10px] text-gray-500 mt-1">In</div>
              <div className="font-mono text-base">{formatHoraLocal(card.fechaEvento)}</div>
              <div className="text-[10px] text-gray-500 mt-2">Out</div>
              {editing && !isHistorical ? (
                <input
                  type="time"
                  title="Hora de fin de la sesión (Time Out)"
                  aria-label="Time Out"
                  value={timeoutVal}
                  onChange={e => setTimeoutVal(e.target.value)}
                  className="w-28 border border-gray-300 rounded px-2 py-0.5 text-sm font-mono"
                />
              ) : (
                <div className="font-mono text-base">{card.timeout || '--:--'}</div>
              )}
            </DataBlock>

            <DataBlock label="Asistencia">
              {card.kind === 'vigente' ? (
                <>
                  <div className="text-[10px] text-gray-500 mt-1">Agend</div>
                  <div className="font-mono">{agend}</div>
                  <div className="text-[10px] text-gray-500 mt-1">Attend</div>
                  <div className="font-mono">{attend}</div>
                  <div className="text-[10px] text-gray-500 mt-1">Absen</div>
                  <div className="font-mono">{absen}</div>
                </>
              ) : (
                <div className="text-xs text-gray-500 italic">no aplica</div>
              )}
            </DataBlock>

            <DataBlock label="Estado">
              <div className="font-medium text-sm">{stateLabel(card)}</div>
              {card.kind === 'historico' && (
                <>
                  <div className="text-[10px] text-gray-500 mt-2">Por</div>
                  <div className="text-xs text-gray-700">{card.canceladoPor}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{new Date(card.fechaTransicion).toLocaleString('es')}</div>
                  {card.motivoTransicion && (
                    <div className="text-xs text-gray-600 italic mt-1">{card.motivoTransicion}</div>
                  )}
                </>
              )}
              {card.kind === 'vigente' && isClosed && card.fechaCierreSesion && (
                <div className="text-[10px] text-gray-500 mt-2">
                  Cerrada: {new Date(card.fechaCierreSesion).toLocaleString('es')}
                </div>
              )}
            </DataBlock>

            <DataBlock label="Observaciones">
              {editing && !isHistorical ? (
                <textarea
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                  placeholder="Notas del advisor"
                />
              ) : (
                <div className="text-xs text-gray-700 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                  {card.notasadvisor || <span className="text-gray-400 italic">sin notas</span>}
                </div>
              )}
            </DataBlock>
          </div>

          {/* Observaciones del evento (admin) */}
          {card.kind === 'vigente' && card.observacionesEvento && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded text-xs">
              <div className="font-semibold text-amber-900 mb-1">Observaciones del evento (admin)</div>
              <div className="text-amber-800 whitespace-pre-wrap">{card.observacionesEvento}</div>
            </div>
          )}

          {/* Footer con acciones */}
          {!isHistorical && (
            <div className="border-t border-gray-200 pt-4 mt-4 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {!card.canEdit && card.editReason}
              </div>
              {canEditNotes && (
                <div className="flex items-center gap-2">
                  {err && <span className="text-xs text-red-600">{err}</span>}
                  {!editing ? (
                    <button
                      type="button"
                      onClick={() => {
                        // Auto-llenar timeout con hora actual si aún no tiene valor
                        if (!timeoutVal) {
                          const now = new Date()
                          const hh = String(now.getHours()).padStart(2, '0')
                          const mm = String(now.getMinutes()).padStart(2, '0')
                          setTimeoutVal(`${hh}:${mm}`)
                        }
                        // Si admin edita sesión cerrada → pasa por warning primero
                        startEdit()
                      }}
                      className={`px-3 py-1.5 text-sm border rounded ${isAdminEditor && isClosed ? 'border-amber-600 text-amber-700 hover:bg-amber-50' : 'border-blue-600 text-blue-600 hover:bg-blue-50'}`}
                    >
                      {isAdminEditor && isClosed ? '⚠️ Editar (sesión cerrada)' : 'Editar Time Out / Notas'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { setEditing(false); setTimeoutVal(card.timeout || ''); setNotas(card.notasadvisor || '') }}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={save}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? 'Guardando…' : 'Guardar'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de warning para admin editando sesión cerrada — motivo obligatorio */}
      {showClosedWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-70">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              ⚠️ Sesión cerrada — edición admin
            </h3>
            <p className="text-sm text-gray-700 mb-4">
              Esta sesión ya fue <strong>registrada (cerrada)</strong>
              {card.kind === 'vigente' && card.fechaCierreSesion
                ? ` el ${new Date(card.fechaCierreSesion).toLocaleString('es')}`
                : ''}.
              Como administrador, puedes editarla; la modificación quedará
              registrada en el log de auditoría con tu usuario y motivo.
            </p>

            <label className="flex items-start gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={warningChecked}
                onChange={e => setWarningChecked(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-sm text-gray-800">
                Confirmo que necesito editar los datos de esta sesión cerrada
              </span>
            </label>

            <div className="mb-4">
              <label htmlFor="admin-edit-motivo" className="block text-xs font-medium text-gray-700 mb-1">
                Motivo <span className="text-red-600">*</span>
              </label>
              <textarea
                id="admin-edit-motivo"
                rows={3}
                value={adminMotivo}
                onChange={e => setAdminMotivo(e.target.value)}
                placeholder="Ej: el advisor reportó Time Out incorrecto vía WhatsApp"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                El motivo se guarda en el log de auditoría junto a tu email y los valores anteriores/nuevos.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowClosedWarning(false); setWarningChecked(false); setAdminMotivo('') }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmAdminEdit}
                disabled={!warningChecked || !adminMotivo.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuar a editar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DataBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded p-2.5 border border-gray-200">
      <div className="text-[10px] uppercase tracking-wide text-gray-600 font-bold mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  )
}
