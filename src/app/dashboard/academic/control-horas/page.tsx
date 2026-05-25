'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
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

interface AdvisorOption { _id: string; nombre: string; email: string }

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
  const role = (session?.user as any)?.role as string | undefined
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN'
  const myEmail = (session?.user as any)?.email as string | undefined

  const [advisorId, setAdvisorId] = useState<string>('')
  const [advisors, setAdvisors] = useState<AdvisorOption[]>([])

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{ vigentes: VigenteRow[]; historicos: HistoricoRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedCard, setSelectedCard] = useState<EventCard | null>(null)

  useEffect(() => {
    if (!myEmail) return
    if (isAdmin) {
      fetch('/api/postgres/advisors')
        .then(r => r.json())
        .then(j => {
          const list: AdvisorOption[] = (j.advisors || j.data || []).map((a: any) => ({
            _id: a._id,
            nombre: `${a.primerNombre ?? ''} ${a.primerApellido ?? ''}`.trim() || a.email,
            email: a.email,
          }))
          setAdvisors(list)
          if (list[0]) setAdvisorId(list[0]._id)
        })
        .catch(() => { /* ignore */ })
    } else {
      fetch(`/api/postgres/advisors/by-email/${encodeURIComponent(myEmail)}`)
        .then(r => r.json())
        .then(j => {
          const id = j.advisor?._id
          if (id) setAdvisorId(id)
          else setError('Tu usuario no está registrado como advisor')
        })
        .catch(() => setError('No se pudo cargar tu perfil de advisor'))
    }
  }, [myEmail, isAdmin])

  const fetchMonth = useCallback(async () => {
    if (!advisorId) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(
        `/api/postgres/advisors/${advisorId}/control-horas?year=${year}&month=${month}`,
        { cache: 'no-store' },
      )
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error cargando datos')
      setData({ vigentes: json.vigentes ?? [], historicos: json.historicos ?? [] })
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

  // Mapeo eventoId → card (para refrescar selectedCard tras un save sin perder modal)
  const cardsByEvent = useMemo(() => {
    const m = new Map<string, EventCard>()
    if (!data) return m
    data.vigentes.forEach(v => m.set(v.eventoId, { ...v, kind: 'vigente' }))
    data.historicos.forEach(h => {
      // Si ya hay vigente con ese eventoId, el histórico va por logId distinto (clave compuesta)
      m.set(`${h.eventoId}_${h.logId}`, { ...h, kind: 'historico' })
    })
    return m
  }, [data])

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

  // Totales del mes — por tipo (vigentes + históricos) y por estado
  const totales = useMemo(() => {
    const t = { sessions: 0, clubs: 0, welcome: 0, conducted: 0, canceled: 0, suspended: 0 }
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
      <div className="flex items-center gap-3 mb-6">
        <ClockIcon className="h-7 w-7 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">Control de Horas</h1>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        {isAdmin && (
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
        <button type="button" onClick={fetchMonth} disabled={!advisorId}
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
          canEditNotes={!isAdmin && selectedCard.kind === 'vigente' && selectedCard.canEdit}
          onClose={() => setSelectedCard(null)}
          onSaved={async () => {
            await fetchMonth()
            // Refrescar selectedCard con el dato actualizado
            const fresh = cardsByEvent.get((selectedCard as VigenteRow).eventoId)
            if (fresh) setSelectedCard(fresh)
            else setSelectedCard(null)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────

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
  card, canEditNotes, onClose, onSaved,
}: {
  card: EventCard
  canEditNotes: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const isHistorical = card.kind === 'historico'
  const [editing, setEditing] = useState(false)
  const [timeoutVal, setTimeoutVal] = useState(card.timeout || '')
  const [notas, setNotas] = useState(card.notasadvisor || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Sincronizar estado interno si llega un card nuevo desde el padre
  useEffect(() => {
    setTimeoutVal(card.timeout || '')
    setNotas(card.notasadvisor || '')
    setEditing(false)
    setErr(null)
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
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error guardando')
      toast.success('Guardado')
      setEditing(false)
      onSaved()
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
                        setEditing(true)
                      }}
                      className="px-3 py-1.5 text-sm border border-blue-600 text-blue-600 rounded hover:bg-blue-50"
                    >
                      Editar Time Out / Notas
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
