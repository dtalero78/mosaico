'use client'

/**
 * Dashboard personalizado para usuarios con rol ADVISOR.
 *
 * Se renderiza en `/` cuando `session.user.role === 'ADVISOR'`. Muestra:
 *   1. Header con foto + saludo
 *   2. 7 KPIs del mes corriente: Sessions, Training, Clubs (otros), Welcome,
 *      Conducted, Canceled, Suspended
 *   3. Heatmap del mes (grid 7×6) con tonos azules para `conducted` y rojos
 *      para `canceled` — intensidad proporcional al total del día
 *   4. 2 donuts: composición por tipo (Sessions/Training/Clubs/Welcome) y por
 *      estado (Conducted/Canceled/Suspended)
 *
 * Datos: reutiliza el endpoint `/api/postgres/advisors/[id]/control-horas`
 * (el mismo que alimenta Ctrl Horas). Cero queries nuevas en backend; todo
 * el derivado (Training vs resto, KPIs, heatmap) es client-side sobre el
 * payload mensual.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ClockIcon } from '@heroicons/react/24/outline'

interface VigenteRow {
  source: 'CALENDARIO'
  eventoId: string
  fechaEvento: string
  tipo: string | null
  nivel: string | null
  step: string | null
  sesionCerrada: boolean
}

interface HistoricoRow {
  source: 'LOG'
  logId: string
  eventoId: string
  fechaEvento: string
  tipo: string | null
  nivel: string | null
  step: string | null
  estado: 'Canceled' | 'Suspended'
}

interface AdvisorInfo {
  _id: string
  primerNombre?: string
  primerApellido?: string
  email: string
  fotoAdvisor?: string | null
}

const WEEKDAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
/** Rango horario del heatmap (06:00–21:00). Eventos fuera de este rango se omiten. */
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

/** Un step de CLUB es Training sólo si su nombre empieza con "TRAINING -". */
function isTrainingStep(step: string | null): boolean {
  return !!step && step.trim().toUpperCase().startsWith('TRAINING -')
}

export default function AdvisorDashboard() {
  const { data: session } = useSession()
  const email = (session?.user as any)?.email as string | undefined

  const [advisor, setAdvisor] = useState<AdvisorInfo | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [data, setData] = useState<{ vigentes: VigenteRow[]; historicos: HistoricoRow[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth() + 1   // 1-12

  // Paso 1 — resolver ADVISORS._id desde el email de sesión
  useEffect(() => {
    if (!email) return
    fetch(`/api/postgres/advisors/by-email/${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(j => {
        if (j?.advisor?._id) {
          setAdvisor(j.advisor)
        } else {
          setError('Tu usuario no está registrado como advisor')
          setLoading(false)
        }
      })
      .catch(() => {
        setError('No se pudo cargar tu perfil de advisor')
        setLoading(false)
      })
  }, [email])

  // Paso 2 — cargar vista mensual del mes corriente (CALENDARIO + admin events)
  const [adminAgg, setAdminAgg] = useState<{ registradas: number; sinRegistrar: number }>({ registradas: 0, sinRegistrar: 0 })
  useEffect(() => {
    if (!advisor?._id) return
    setLoading(true); setError(null)
    Promise.all([
      fetch(`/api/postgres/advisors/${advisor._id}/control-horas?year=${year}&month=${month}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`/api/postgres/advisors/${advisor._id}/admin-events?year=${year}&month=${month}`, { cache: 'no-store' }).then(r => r.json()),
    ])
      .then(([j1, j2]) => {
        if (!j1.success) throw new Error(j1.error || 'Error cargando datos')
        setData({ vigentes: j1.vigentes ?? [], historicos: j1.historicos ?? [] })
        if (j2?.success) setAdminAgg(j2.aggregate || { registradas: 0, sinRegistrar: 0 })
      })
      .catch((e: any) => setError(e?.message || 'Error desconocido'))
      .finally(() => setLoading(false))
  }, [advisor?._id, year, month])

  // Foto del advisor (presigned URL, TTL 10 min)
  useEffect(() => {
    setFotoUrl(null)
    const key = advisor?.fotoAdvisor
    if (!key) return
    fetch(`/api/postgres/materials/presigned?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(d => { if (d.signedUrl) setFotoUrl(d.signedUrl) })
      .catch(() => { /* fallback a inicial */ })
  }, [advisor?.fotoAdvisor])

  // ── Derivados ────────────────────────────────────────────────────────────
  // KPIs del mes — desglose por tipo y por estado.
  // Training se separa de "Clubs (otros)" mirando el prefijo del step.
  //
  // Effective Hours / Hours without recording son las 2 caras del Conducted:
  //   - effective = vigentes con sesionCerrada=true (registradas por advisor o coord)
  //   - sinRegistrar = vigentes con sesionCerrada=false/null (pendientes)
  // effective + sinRegistrar = conducted.
  const kpis = useMemo(() => {
    const k = {
      sessions: 0, training: 0, clubs: 0, welcome: 0,
      conducted: 0, canceled: 0, suspended: 0,
      effective: 0, sinRegistrar: 0,
      administrative: 0,
    }
    if (!data) return k

    const countTipoStep = (tipo: string | null, step: string | null) => {
      const t = (tipo || '').toUpperCase()
      if (t === 'SESSION')      k.sessions++
      else if (t === 'CLUB')    isTrainingStep(step) ? k.training++ : k.clubs++
      else if (t === 'WELCOME') k.welcome++
    }

    // KPIs solo cuentan eventos que YA ocurrieron (fechaEvento <= NOW).
    // Eventos futuros del mes son agenda, no actividad real.
    const nowMs = Date.now()
    const isPast = (iso: string | null | undefined) =>
      iso != null && new Date(iso).getTime() <= nowMs
    data.vigentes.forEach(v => {
      if (!isPast(v.fechaEvento)) return
      countTipoStep(v.tipo, v.step)
      k.conducted++
      if (v.sesionCerrada === true) k.effective++
      else                          k.sinRegistrar++
    })
    data.historicos.forEach(h => {
      if (!isPast(h.fechaEvento)) return
      countTipoStep(h.tipo, h.step)
      if (h.estado === 'Canceled')  k.canceled++
      if (h.estado === 'Suspended') k.suspended++
    })
    // Admin events:
    //   - Effective suma las registradas (horas ya "marcadas tarjeta").
    //   - Hours without recording suma las sin registrar (pendientes).
    //   - Administrative muestra el TOTAL del mes (registradas + sin registrar).
    //     Así se cumple la identidad visible al advisor:
    //       effective = conducted + administrative - hoursWithoutRecording
    k.effective      += adminAgg.registradas
    k.sinRegistrar   += adminAgg.sinRegistrar
    k.administrative  = adminAgg.registradas + adminAgg.sinRegistrar
    return k
  }, [data, adminAgg])

  // Heatmaps Día × Hora del mes (Lun-Dom × 06:00-21:00).
  // 2 matrices: conducted (azul) y canceled (rojo). Agregado por weekday × hora.
  // Suspended se omite (ruido en el grid).
  const monthly = useMemo(() => {
    const mkMatrix = () => Array.from({ length: 7 }, () => Array(HOURS.length).fill(0)) as number[][]
    const result = { conducted: mkMatrix(), canceled: mkMatrix() }
    if (!data) return result

    const nowMs = Date.now()
    const addEvent = (iso: string, bucket: 'conducted' | 'canceled') => {
      const d = new Date(iso)
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) return
      if (d.getTime() > nowMs) return         // heatmap = actividad pasada
      const wd = (d.getDay() + 6) % 7         // 0=Lun, 6=Dom
      const hIdx = HOURS.indexOf(d.getHours())
      if (hIdx < 0) return                     // fuera de 06-21
      result[bucket][wd][hIdx]++
    }
    data.vigentes.forEach(v => addEvent(v.fechaEvento, 'conducted'))
    data.historicos.forEach(h => { if (h.estado === 'Canceled') addEvent(h.fechaEvento, 'canceled') })
    return result
  }, [data, year, month])

  const matrixMax = (m: number[][]) => m.flat().reduce((a, b) => Math.max(a, b), 0)
  const monthlyConductedMax = useMemo(() => matrixMax(monthly.conducted), [monthly])
  const monthlyCanceledMax  = useMemo(() => matrixMax(monthly.canceled),  [monthly])

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
        Cargando tu dashboard…
      </div>
    )
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">{error}</div>
  }

  const mesLabel = `${MES_ES[month - 1]} ${year}`
  const totalTipos = kpis.sessions + kpis.training + kpis.clubs + kpis.welcome
  const totalEstados = kpis.conducted + kpis.canceled + kpis.suspended

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <AdvisorAvatar fotoUrl={fotoUrl} inicial={advisor?.primerNombre?.[0]?.toUpperCase() || 'A'} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            ¡Hola {advisor?.primerNombre || ''}!
          </h1>
          <p className="mt-1 text-sm text-gray-600 flex items-center gap-1.5">
            <ClockIcon className="h-4 w-4 text-blue-600" />
            Tu actividad del mes — <span className="font-medium capitalize">{mesLabel}</span>
          </p>
        </div>
      </div>

      {/* KPIs destacados — Effective | Sin registrar | Administrative.
          Administrative ya está sumado en Effective; se muestra como tercer KPI
          para que el advisor sepa cuántas de sus horas efectivas vienen de
          eventos administrativos (Training/Support/...). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Effective Hours"
          value={kpis.effective}
          color="bg-emerald-50  border-emerald-400  text-emerald-700"
          big
        />
        <KpiCard
          label="Hours without recording"
          value={kpis.sinRegistrar}
          color="bg-amber-50    border-amber-400    text-amber-700"
          big
        />
        <KpiCard
          label="Administrative Hours"
          value={kpis.administrative}
          color="bg-violet-50   border-violet-400   text-violet-700"
          big
        />
      </div>

      {/* KPIs detalle */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <KpiCard label="Sessions"  value={kpis.sessions}  color="bg-blue-50    border-blue-300    text-blue-700" />
        <KpiCard label="Training"  value={kpis.training}  color="bg-orange-50  border-orange-300  text-orange-700" />
        <KpiCard label="Clubs"     value={kpis.clubs}     color="bg-green-50   border-green-300   text-green-700" />
        <KpiCard label="Welcome"   value={kpis.welcome}   color="bg-purple-50  border-purple-300  text-purple-700" />
        <KpiCard label="Conducted" value={kpis.conducted} color="bg-sky-50     border-sky-300     text-sky-700" />
        <KpiCard label="Canceled"  value={kpis.canceled}  color="bg-red-50     border-red-300     text-red-700" />
        <KpiCard label="Suspended" value={kpis.suspended} color="bg-yellow-50  border-yellow-300  text-yellow-800" />
      </div>

      {/* Heatmaps Día × Hora del mes — Conducted (azul) | Canceladas (rojo o mensaje) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DayHourHeatmap
          title="Conducted — Día vs Hora"
          subtitle={mesLabel}
          matrix={monthly.conducted}
          max={monthlyConductedMax}
          darkColor="#1d4ed8"
          lightColor="#dbeafe"
        />
        <DayHourHeatmap
          title="Canceladas — Día vs Hora"
          subtitle={mesLabel}
          matrix={monthly.canceled}
          max={monthlyCanceledMax}
          darkColor="#b91c1c"
          lightColor="#fee2e2"
          emptyMessage="¡Excelente! No has cancelado ninguna sesión este mes."
        />
      </div>

      {/* Donuts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DonutCard
          title="Composición por tipo"
          total={totalTipos}
          segments={[
            { label: 'Sessions', value: kpis.sessions, color: '#3b82f6' },
            { label: 'Training', value: kpis.training, color: '#f97316' },
            { label: 'Clubs',    value: kpis.clubs,    color: '#22c55e' },
            { label: 'Welcome',  value: kpis.welcome,  color: '#a855f7' },
          ]}
        />
        <DonutCard
          title="Composición por estado"
          total={totalEstados}
          segments={[
            { label: 'Conducted', value: kpis.conducted, color: '#0ea5e9' },
            { label: 'Canceled',  value: kpis.canceled,  color: '#ef4444' },
            { label: 'Suspended', value: kpis.suspended, color: '#eab308' },
          ]}
        />
      </div>
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
          </div>}
    </div>
  )
}

function KpiCard({ label, value, color, big }: { label: string; value: number; color: string; big?: boolean }) {
  // Mismo padding y altura que las cards normales; solo la card 'big' tiene
  // borde mas grueso para destacar — la altura final coincide visualmente.
  return (
    <div className={`${color} ${big ? 'border-2' : 'border'} rounded-lg px-3 py-2 text-center`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className={big ? 'text-xs uppercase tracking-wide font-semibold' : 'text-[10px] uppercase tracking-wide font-semibold'}>{label}</div>
    </div>
  )
}

/**
 * Heatmap compacto Día × Hora. Cada celda es ~22×22 px.
 * `matrix[wd][hIdx]` = # eventos en weekday wd (0=Lun, 6=Dom) a la hora HOURS[hIdx].
 * Color: tono interpolado entre lightColor (claro) y darkColor (oscuro) por intensidad.
 * Si max=0 y se provee emptyMessage, muestra el mensaje amigable en vez del grid.
 */
function DayHourHeatmap({ title, subtitle, matrix, max, darkColor, lightColor, emptyMessage }: {
  title: string
  subtitle: string
  matrix: number[][]
  max: number
  darkColor: string
  lightColor: string
  emptyMessage?: string
}) {
  const isEmpty = max === 0
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-500 capitalize">{subtitle}</span>
      </div>
      {isEmpty && emptyMessage ? (
        <div className="flex items-center justify-center min-h-[200px] text-center px-6">
          <p className="text-sm font-medium text-green-700">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-[10px]">
            <thead>
              <tr>
                <th className="w-8"><span className="sr-only">Día</span></th>
                {HOURS.map(h => (
                  <th key={h} className="w-6 text-center font-medium text-gray-500">
                    {String(h).padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS_ES.map((dayLabel, wd) => (
                <tr key={dayLabel}>
                  <td className="pr-1 text-right font-medium text-gray-500">{dayLabel}</td>
                  {HOURS.map((h, hIdx) => {
                    const v = matrix[wd][hIdx]
                    const bg = scaleColor(v, max, darkColor, lightColor)
                    return (
                      <td
                        key={h}
                        className="w-6 h-6 text-center align-middle rounded border border-gray-100"
                        style={bg ? { backgroundColor: bg } : undefined}
                        title={`${dayLabel} ${String(h).padStart(2, '0')}:00 — ${v} evento(s)`}
                      >
                        <span className={v >= Math.ceil(max * 0.6) ? 'text-white font-semibold' : 'text-gray-700'}>
                          {v || ''}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Interpola un color entre `light` y `dark` según `value/max` (0..1).
 * Si max es 0, devuelve null (no pintar).
 */
function scaleColor(value: number, max: number, dark: string, light: string): string | null {
  if (!value || !max) return null
  const t = Math.max(0.15, value / max)        // mínimo 15% para que sea visible
  return mixHex(light, dark, t)
}

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a), pb = hexToRgb(b)
  const r = Math.round(pa.r + (pb.r - pa.r) * t)
  const g = Math.round(pa.g + (pb.g - pa.g) * t)
  const bl = Math.round(pa.b + (pb.b - pa.b) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const v = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  }
}

// ─────────────────────────────────────────────────────────

/**
 * Donut SVG ligera (sin recharts) — patrón ya usado en informes Welcome Session.
 * Centro muestra el total. Leyenda lateral con label / value / %.
 * Si total=0, dibuja un círculo gris (placeholder) y muestra "Sin datos".
 */
function DonutCard({ title, total, segments }: {
  title: string
  total: number
  segments: { label: string; value: number; color: string }[]
}) {
  const r = 60, cx = 75, cy = 75, sw = 24
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {total === 0 ? (
        <div className="flex items-center justify-center h-[150px] text-sm text-gray-400">
          Sin datos para este mes
        </div>
      ) : (
        <div className="flex items-center gap-6 flex-wrap">
          <svg width="150" height="150" viewBox="0 0 150 150">
            {segments.map((seg, i) => {
              if (!seg.value) return null
              const pct = seg.value / total
              const dash = pct * circ
              const gap = circ - dash
              const rot = offset * 360 - 90
              offset += pct
              return (
                <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                  stroke={seg.color} strokeWidth={sw}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeLinecap="butt"
                  transform={`rotate(${rot} ${cx} ${cy})`}
                />
              )
            })}
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#1f2937">
              {total.toLocaleString()}
            </text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#6b7280">TOTAL</text>
          </svg>

          <div className="space-y-2 flex-1 min-w-[180px]">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-gray-600 flex-1">{seg.label}</span>
                <span className="font-semibold text-gray-900 w-10 text-right">{seg.value.toLocaleString()}</span>
                <span className="text-gray-400 text-xs w-12 text-right">
                  {total > 0 ? `${((seg.value / total) * 100).toFixed(1)}%` : '0%'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
