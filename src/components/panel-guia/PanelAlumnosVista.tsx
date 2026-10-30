'use client'

/**
 * Panel del guía › "Mis alumnos por curso" — la vista (pestañas, tarjetas, tabla).
 *
 * Replica el diseño aprobado (PDF "Panel del guía · alumnos por curso") con dos
 * ajustes decididos: el acento es el morado de MOSAICO (primary-600) y los colores
 * de estado son los del diseño, exactos. Todo umbral sale de
 * `lib/reglas-alertas-guia`: aquí sólo se pinta lo que esas reglas deciden, y el
 * estado nunca se comunica sólo por color (siempre va con cifra o texto).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { IBM_Plex_Mono } from 'next/font/google'
import {
  tonoAsistencia, tonoNota, tonoCriterio, formatoNota, UMBRALES, type Tono,
} from '@/lib/reglas-alertas-guia'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'
import type { FilaResumenAlumno } from '@/lib/resumen-guia'
import type { CursoResumenGuia } from '@/services/resumen-guia.service'

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '600'], display: 'swap' })

// ─── Tokens del diseño ───────────────────────────────────────────────────────
const C = {
  texto: 'text-[#17212B]',
  sec: 'text-[#556270]',
  borde: 'border-[#E1E6EC]',
}
const TONO_TEXTO: Record<Tono, string> = {
  risk: 'text-[#B42318]', warn: 'text-[#B45309]', ok: 'text-[#0F6B5C]', none: 'text-[#556270]',
}
const TONO_BARRA: Record<Tono, string> = {
  risk: 'bg-[#B42318]', warn: 'bg-[#B45309]', ok: 'bg-[#0F6B5C]', none: 'bg-gray-300',
}
const PUNTO: Record<'risk' | 'warn' | 'ok', { cls: string; label: string }> = {
  risk: { cls: 'bg-[#B42318]', label: 'Con alertas rojas' },
  warn: { cls: 'bg-[#B45309]', label: 'Con alertas ámbar' },
  ok: { cls: 'bg-[#0F6B5C]', label: 'Sin alertas' },
}
const ETIQUETA_ALERTA = {
  risk: 'bg-[#FDECEA] text-[#9A1B12]',
  warn: 'bg-[#FEF1DD] text-[#8A3C06]',
}

// ─── Formatos ────────────────────────────────────────────────────────────────
/** "10 oct", en hora de Chile. */
export const fechaCorta = (iso: string | null) => {
  if (!iso) return ''
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short' })
    .format(new Date(iso)).replace('.', '').replace(/\bsept\b/, 'sep')
}

/** "LUN-MIÉ 18:15-19:15" → "Lun-Mié 18:15". */
export function horarioCorto(h: string | null | undefined): string {
  const s = String(h || '').trim()
  const m = s.match(/^(.*?)\s+(\d{1,2}:\d{2})/)
  if (!m) return s
  const dias = m[1].split('-').map(d => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()).join('-')
  return `${dias} ${m[2]}`
}

const pctAncho = (n: number, d: number) => (d > 0 ? Math.max(0, Math.min(100, Math.round((100 * n) / d))) : 0)

// ─── Pestañas de curso ───────────────────────────────────────────────────────
function PestanasCurso({ cursos, activo, onElegir }: {
  cursos: CursoResumenGuia[]; activo: string | null; onElegir: (id: string) => void
}) {
  // La pestaña elegida tiene que quedar a la vista: con 8 cursos, la del curso en
  // que se hizo clic en Cursos asignados suele estar fuera, a la derecha.
  const activaRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activaRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activo])
  return (
    <div className="mt-6 -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Cursos">
      {cursos.map(c => {
        const sel = c.cursoId === activo
        const n = c.resumen.conAlertas
        return (
          <button key={c.cursoId} ref={sel ? activaRef : undefined} type="button" aria-pressed={sel} onClick={() => onElegir(c.cursoId)}
            className={`min-h-[44px] shrink-0 rounded-[14px] border px-4 py-2.5 text-left transition-colors ${
              sel ? 'border-primary-600 bg-primary-600 text-white' : `${C.borde} bg-white ${C.texto} hover:border-primary-300`}`}>
            <div className="flex items-center gap-3">
              <div>
                <div className="text-sm font-bold tracking-wide uppercase">{c.tipoCurso} · Salón {c.salon || '—'}</div>
                <div className={`text-xs ${sel ? 'text-white/80' : C.sec}`}>
                  {c.campaign} · {horarioCorto(c.horarioCurso)} · {c.resumen.alumnos} alumnos
                </div>
              </div>
              <span className={`${mono.className} whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                sel ? (n > 0 ? 'bg-white text-[#B42318]' : 'bg-white/20 text-white')
                    : (n > 0 ? 'bg-[#FDECEA] text-[#9A1B12]' : 'bg-gray-100 text-[#556270]')}`}>
                {n} con alertas
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Tarjetas de resumen ─────────────────────────────────────────────────────
function Tarjeta({ titulo, valor, tono = 'none', sub }: { titulo: string; valor: string; tono?: Tono | 'neutro'; sub: string }) {
  const color = tono === 'neutro' ? C.texto : TONO_TEXTO[tono]
  return (
    <div className={`rounded-[14px] border ${C.borde} bg-white p-4`}>
      <div className={`text-xs ${C.sec}`}>{titulo}</div>
      <div className={`${mono.className} mt-1 text-3xl font-semibold ${color}`}>{valor}</div>
      <div className={`mt-1 text-xs ${C.sec}`}>{sub}</div>
    </div>
  )
}

function TarjetasResumen({ curso }: { curso: CursoResumenGuia }) {
  const r = curso.resumen
  const pctAlertas = r.alumnos ? Math.round((100 * r.conAlertas) / r.alumnos) : 0
  const evalSub = r.evaluacionesDictadas
    ? `${r.evaluacionesDictadas} evaluaciones · ${r.evaluacionesPendientes} pendientes`
    : 'Sin evaluaciones dictadas'
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Tarjeta titulo="Alumnos activos" valor={String(r.alumnos)} tono="neutro" sub={horarioCorto(curso.horarioCurso)} />
      <Tarjeta titulo="Con alertas" valor={String(r.conAlertas)} tono={r.conAlertas > 0 ? 'risk' : 'ok'} sub={`${pctAlertas}% del curso`} />
      <Tarjeta titulo="Asistencia media" valor={r.asistenciaMedia === null ? '—' : `${r.asistenciaMedia}%`}
        tono={tonoAsistencia(r.asistenciaMedia)} sub={`${r.sesionesDictadas} sesiones dictadas`} />
      <Tarjeta titulo="Avance del curso" valor={`${r.leccionesDictadas}/${r.leccionesPrograma}`} tono="neutro"
        sub={`lecciones dictadas${r.moduloActual ? ` · ${r.moduloActual}` : ''}`} />
      <Tarjeta titulo="Promedio evaluaciones" valor={r.promedioEvaluaciones === null ? '—' : formatoNota(r.promedioEvaluaciones)}
        tono={tonoNota(r.promedioEvaluaciones)} sub={evalSub} />
      <Tarjeta titulo="Casos abiertos" valor={String(r.casosAbiertos)} tono={r.casosAbiertos > 0 ? 'risk' : 'none'} sub="en gestión" />
    </div>
  )
}

// ─── Tabla ───────────────────────────────────────────────────────────────────
// Suma mínima ≈ 1.270 px con relleno y separaciones: cabe en el contenedor de
// 1.360 px (y en una laptop de 1.440). Por debajo, la tabla se desplaza dentro
// de su caja, nunca la página.
const COLUMNAS = 'grid grid-cols-[minmax(190px,1.4fr)_minmax(150px,1fr)_minmax(160px,1.1fr)_80px_120px_136px_140px_minmax(180px,1.3fr)] gap-x-3'

function Barra({ pct, tono }: { pct: number; tono: Tono }) {
  return (
    <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#E9EDF2]">
      <div className={`h-1.5 rounded-full ${TONO_BARRA[tono]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function CeldaAlumno({ f }: { f: FilaResumenAlumno }) {
  const p = PUNTO[f.estado]
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${p.cls}`} role="img" aria-label={p.label} title={p.label} />
      <div className="min-w-0">
        {f.academicaId ? (
          <a href={`/student/${f.academicaId}`} target="_blank" rel="noopener noreferrer"
            className={`block line-clamp-2 break-words font-semibold leading-snug ${C.texto} hover:text-primary-600 hover:underline`} title={f.nombre}>{f.nombre}</a>
        ) : (
          <span className={`block line-clamp-2 break-words font-semibold leading-snug ${C.texto}`} title={f.nombre}>{f.nombre}</span>
        )}
        <div className={`text-xs ${C.sec}`}>
          {f.asistencia.ultimaAsistencia ? `Últ. asistencia ${fechaCorta(f.asistencia.ultimaAsistencia)}` : 'Sin asistencias'}
        </div>
      </div>
    </div>
  )
}

function CeldaAsistencia({ f }: { f: FilaResumenAlumno }) {
  const a = f.asistencia
  const tono = tonoAsistencia(a.pct)
  const extras = [a.sinMarcar ? `${a.sinMarcar} s/m` : '', a.justificadas ? `${a.justificadas} just.` : ''].filter(Boolean).join(' · ')
  if (a.sesiones === 0 && !a.sinMarcar && !a.justificadas) {
    return <div className={`text-sm ${C.sec}`}><span className={`${mono.className} text-lg`}>—</span><div className="text-xs">Sin sesiones registradas</div></div>
  }
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className={`${mono.className} text-lg font-semibold ${TONO_TEXTO[tono]}`}>{a.pct === null ? '—' : `${a.pct}%`}</span>
        <span className={`${mono.className} text-xs ${C.sec}`}>{a.presentes}/{a.sesiones}{extras ? ` · ${extras}` : ''}</span>
      </div>
      <Barra pct={a.pct ?? 0} tono={tono} />
      <div className={`mt-1 text-xs ${a.faltasSeguidas >= UMBRALES.faltasSeguidas ? 'font-medium text-[#B42318]' : C.sec}`}>
        {a.faltasSeguidas === 0 ? 'Sin faltas recientes' : a.faltasSeguidas === 1 ? '1 falta reciente' : `${a.faltasSeguidas} faltas seguidas`}
      </div>
    </div>
  )
}

function CeldaLecciones({ f }: { f: FilaResumenAlumno }) {
  const l = f.lecciones
  const aviso = l.sinVer >= UMBRALES.leccionesSinVer
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className={`${mono.className} text-lg font-semibold ${C.texto}`}>{l.vistas}</span>
        <span className={`text-xs ${C.sec}`}>/ {l.totalPrograma} vistas</span>
      </div>
      {/* Barra doble: clara = dictadas, acento = vistas (sobre el total del programa). */}
      <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-[#E9EDF2]" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary-200" style={{ width: `${pctAncho(l.dictadas, l.totalPrograma)}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary-600" style={{ width: `${pctAncho(l.vistas, l.totalPrograma)}%` }} />
      </div>
      <div className={`mt-1 text-xs ${aviso ? 'font-medium text-[#B45309]' : C.sec}`}>
        {l.dictadas === 0 ? 'Sin lecciones dictadas'
          : l.sinVer === 0 ? `Al día (${l.dictadas} dictadas)`
          : `${l.sinVer} sin ver de ${l.dictadas} dictadas`}
      </div>
    </div>
  )
}

function CeldaNivelaciones({ f }: { f: FilaResumenAlumno }) {
  const n = f.nivelaciones
  return (
    <div>
      <div className={`${mono.className} text-lg font-semibold ${n.realizadas ? C.texto : 'text-gray-400'}`}>{n.realizadas}</div>
      <div className={`text-xs ${C.sec}`}>{n.ultima ? `Últ. ${fechaCorta(n.ultima)}` : '—'}</div>
      {n.enCurso && <span className="mt-1 inline-block rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">en curso</span>}
    </div>
  )
}

function CeldaCasos({ f }: { f: FilaResumenAlumno }) {
  const c = f.casos
  const cerrados = c.total - c.abiertos
  const texto = c.abiertos > 0
    ? `${c.abiertos} abierto${c.abiertos > 1 ? 's' : ''}${c.total > c.abiertos ? ` · ${c.total} total` : ''}`
    : cerrados > 0 ? `${cerrados} cerrado${cerrados > 1 ? 's' : ''}` : 'Sin casos'
  const cls = c.abiertos > 0 ? 'bg-[#FDECEA] text-[#9A1B12]' : 'bg-gray-100 text-[#556270]'
  const badge = <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{texto}</span>
  return c.total > 0 && f.academicaId ? (
    <a href={`/student/${f.academicaId}?tab=casos-atencion`} target="_blank" rel="noopener noreferrer" title="Ver casos de atención" className="hover:opacity-80">{badge}</a>
  ) : badge
}

function CeldaEvaluaciones({ f }: { f: FilaResumenAlumno }) {
  const e = f.evaluaciones
  if (e.dictadas === 0 && e.rendidas === 0) {
    return <div className={`text-sm ${C.sec}`}><span className={`${mono.className} text-lg`}>—</span><div className="text-xs">Sin evaluaciones dictadas</div></div>
  }
  const rendidasDeDictadas = e.dictadas - e.pendientes
  return (
    <div>
      <div className={`${mono.className} text-xl font-semibold ${TONO_TEXTO[tonoNota(e.promedio)]}`}>
        {e.promedio === null ? '—' : formatoNota(e.promedio)}
      </div>
      <div className={`text-xs ${e.pendientes > 0 ? 'font-medium text-[#B45309]' : C.sec}`}>
        {e.dictadas ? `${rendidasDeDictadas}/${e.dictadas} rendidas` : `${e.rendidas} rendidas`}
        {e.minima !== null ? ` · mín ${formatoNota(e.minima)}` : ''}
      </div>
    </div>
  )
}

function CeldaCriterios({ f }: { f: FilaResumenAlumno }) {
  return (
    <div className="space-y-1">
      {(['H', 'D', 'A'] as const).map(g => {
        const v = f.criterios[g]
        const tono = tonoCriterio(v)
        return (
          <div key={g} className="flex items-center gap-2">
            <span className={`${mono.className} w-3 text-[11px] font-semibold ${C.sec}`}>{g}</span>
            <div className="h-1.5 flex-1 rounded-full bg-[#E9EDF2]">
              <div className={`h-1.5 rounded-full ${TONO_BARRA[tono]}`} style={{ width: `${v ?? 0}%` }} />
            </div>
            <span className={`${mono.className} w-8 text-right text-[11px] font-semibold ${TONO_TEXTO[tono]}`}>{v === null ? '—' : v}</span>
          </div>
        )
      })}
    </div>
  )
}

function CeldaAlertas({ f }: { f: FilaResumenAlumno }) {
  if (!f.alertas.length) return <span className={`text-xs ${C.sec}`}>Sin alertas</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {f.alertas.map(a => (
        <span key={a.codigo} title={a.detalle}
          className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${ETIQUETA_ALERTA[a.severidad]}`}>
          {a.etiqueta}
        </span>
      ))}
    </div>
  )
}

function TablaAlumnos({ filas, sel }: {
  filas: FilaResumenAlumno[]
  /** Selección para resetear la última evaluación; sin ella no hay casillas. */
  sel?: { marcados: Set<string>; alternar: (id: string) => void; alternarTodos: (marcar: boolean) => void }
}) {
  const COLS = sel ? COLUMNAS.replace('grid-cols-[', 'grid-cols-[28px_') : COLUMNAS
  const ids = filas.map(f => f.academicaId).filter(Boolean) as string[]
  const todos = ids.length > 0 && ids.every(id => sel?.marcados.has(id))
  return (
    <div className={`mt-3 overflow-x-auto rounded-[14px] border ${C.borde} bg-white`}>
      <div className={sel ? 'min-w-[1320px]' : 'min-w-[1280px]'} role="table" aria-label="Alumnos del curso">
        <div className={`${COLS} border-b ${C.borde} bg-[#F8FAFC] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider ${C.sec}`} role="row">
          {sel && (
            <div role="columnheader">
              <input type="checkbox" aria-label="Marcar todos los visibles" checked={todos}
                onChange={e => sel.alternarTodos(e.target.checked)} className="h-4 w-4 accent-primary-600" />
            </div>
          )}
          {['Alumno', 'Asistencia', 'Lecciones', 'Nivelac.', 'Casos', 'Evaluaciones', 'Criterios guía', 'Alertas'].map(h => (
            <div key={h} role="columnheader">{h}</div>
          ))}
        </div>
        {filas.map(f => (
          <div key={f.peopleId} className={`${COLS} items-start border-b ${C.borde} px-4 py-4 last:border-b-0 hover:bg-[#FAFBFC]`} role="row">
            {sel && (
              <div role="cell">
                <input type="checkbox" aria-label={`Marcar a ${f.nombre}`} disabled={!f.academicaId}
                  checked={!!f.academicaId && sel.marcados.has(f.academicaId)}
                  onChange={() => f.academicaId && sel.alternar(f.academicaId)} className="h-4 w-4 accent-primary-600" />
              </div>
            )}
            <div role="cell"><CeldaAlumno f={f} /></div>
            <div role="cell"><CeldaAsistencia f={f} /></div>
            <div role="cell"><CeldaLecciones f={f} /></div>
            <div role="cell"><CeldaNivelaciones f={f} /></div>
            <div role="cell"><CeldaCasos f={f} /></div>
            <div role="cell"><CeldaEvaluaciones f={f} /></div>
            <div role="cell"><CeldaCriterios f={f} /></div>
            <div role="cell"><CeldaAlertas f={f} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Leyenda ─────────────────────────────────────────────────────────────────
function Leyenda() {
  return (
    <p className={`mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs ${C.sec}`}>
      <span><b className="text-[#B42318]">Rojo</b> asistencia &lt; {UMBRALES.asistenciaRiesgo}%, {UMBRALES.faltasSeguidas}+ faltas seguidas, caso abierto, promedio &lt; {formatoNota(UMBRALES.notaRiesgo)}</span>
      <span><b className="text-[#B45309]">Ámbar</b> evaluación pendiente, {UMBRALES.leccionesSinVer}+ lecciones dictadas sin ver</span>
      <span>Criterios: H Hábitos · D Desempeño · A Actitudes (% de cumplimiento; “no aplica” no cuenta)</span>
      <span>s/m: sesión sin marcar · just.: falta justificada (fuera del %)</span>
    </p>
  )
}

// ─── Esqueleto de carga ──────────────────────────────────────────────────────
export function EsqueletoPanel() {
  const b = 'animate-pulse rounded bg-[#E9EDF2]'
  return (
    <div aria-busy="true" aria-label="Cargando el panel">
      <div className="mt-6 flex gap-2">{[0, 1, 2].map(i => <div key={i} className={`${b} h-14 w-56 rounded-[14px]`} />)}</div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className={`${b} h-24 rounded-[14px]`} />)}
      </div>
      <div className={`mt-6 rounded-[14px] border ${C.borde} bg-white p-5 space-y-5`}>
        {[0, 1, 2, 3, 4].map(i => <div key={i} className={`${b} h-10`} />)}
      </div>
    </div>
  )
}

// ─── Vista completa ──────────────────────────────────────────────────────────
export default function PanelAlumnosVista({ cursos, cursoActivo, onElegirCurso, guiaId, onRecargar }: {
  cursos: CursoResumenGuia[]; cursoActivo: CursoResumenGuia; onElegirCurso: (id: string) => void
  /** Con ambos (y el permiso) aparecen las casillas para resetear la última evaluación. */
  guiaId?: string; onRecargar?: () => void
}) {
  const { hasPermission } = usePermissions()
  const puedeResetear = !!guiaId && hasPermission(AcademicoPermission.PANEL_ALUMNOS_RESETEAR_EVALUACION)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState<'marcados' | 'todos' | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  // Al cambiar de curso la selección empieza limpia.
  useEffect(() => { setMarcados(new Set()); setConfirmar(null) }, [cursoActivo.cursoId])

  const resetear = async () => {
    if (!guiaId || !confirmar) return
    setEnviando(true); setAviso(null)
    try {
      const res = await fetch(`/api/postgres/guias/${encodeURIComponent(guiaId)}/resetear-evaluacion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmar === 'todos'
          ? { cursoId: cursoActivo.cursoId, todos: true }
          : { cursoId: cursoActivo.cursoId, academicaIds: Array.from(marcados) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.success === false) throw new Error(j.error || 'No se pudo resetear')
      setAviso({ ok: true, texto: `Evaluación reiniciada a ${j.reseteados} alumno(s)${j.sinEvaluacion ? ` · ${j.sinEvaluacion} sin evaluación presentada` : ''}. Ya pueden presentarla de nuevo.` })
      setMarcados(new Set()); onRecargar?.()
    } catch (e: any) {
      setAviso({ ok: false, texto: e?.message || 'No se pudo resetear' })
    } finally { setEnviando(false); setConfirmar(null) }
  }

  const [soloAlertas, setSoloAlertas] = useState(false)
  const filas = useMemo(
    () => (soloAlertas ? cursoActivo.filas.filter(f => f.alertas.length > 0) : cursoActivo.filas),
    [soloAlertas, cursoActivo],
  )
  const total = cursoActivo.filas.length

  return (
    <>
      <PestanasCurso cursos={cursos} activo={cursoActivo.cursoId} onElegir={onElegirCurso} />
      <TarjetasResumen curso={cursoActivo} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className={`text-sm ${C.sec}`}>
          <b className={C.texto}>{cursoActivo.tipoCurso} · Salón {cursoActivo.salon || '—'}</b>
          {cursoActivo.resumen.moduloActual ? ` · ${cursoActivo.resumen.moduloActual}` : ''}
          {` · ${filas.length} de ${total} alumnos · primero los que tienen alertas`}
        </p>
        <button type="button" aria-pressed={soloAlertas} onClick={() => setSoloAlertas(v => !v)}
          className={`min-h-[44px] rounded-full border px-5 text-sm font-medium ${
            soloAlertas ? 'border-primary-600 bg-primary-600 text-white' : `${C.borde} bg-white ${C.texto} hover:border-primary-300`}`}>
          Solo con alertas
        </button>
      </div>

      {total === 0 ? (
        <div className={`mt-3 rounded-[14px] border ${C.borde} bg-white p-8 text-center text-sm ${C.sec}`}>Este curso aún no tiene alumnos.</div>
      ) : filas.length === 0 ? (
        <div className={`mt-3 rounded-[14px] border ${C.borde} bg-white p-8 text-center text-sm ${C.sec}`}>Ningún alumno de este curso tiene alertas.</div>
      ) : (
        <>
          {puedeResetear && (
            <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-[14px] border ${C.borde} bg-white px-4 py-3`}>
              <span className={`text-sm ${C.sec}`}>Última evaluación:</span>
              <button type="button" disabled={marcados.size === 0 || enviando} onClick={() => setConfirmar('marcados')}
                className="min-h-[44px] rounded-[14px] border border-primary-600 px-4 text-sm font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-40">
                Resetear marcados ({marcados.size})
              </button>
              <button type="button" disabled={enviando} onClick={() => setConfirmar('todos')}
                className="min-h-[44px] rounded-[14px] border border-[#E1E6EC] px-4 text-sm font-medium text-[#17212B] hover:border-primary-300 disabled:opacity-40">
                Resetear a todos
              </button>
              <span className={`text-xs ${C.sec}`}>Reinicia los 3 intentos; el historial se conserva.</span>
            </div>
          )}
          {aviso && (
            <div role={aviso.ok ? 'status' : 'alert'} className={`mt-3 rounded-[14px] border p-3 text-sm ${aviso.ok ? 'border-[#B7E4C7] bg-[#ECFDF3] text-[#05603A]' : 'border-[#F5C2BC] bg-[#FDECEA] text-[#9A1B12]'}`}>{aviso.texto}</div>
          )}
          <TablaAlumnos filas={filas} sel={puedeResetear ? {
            marcados,
            alternar: id => setMarcados(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }),
            alternarTodos: marcar => setMarcados(p => {
              const n = new Set(p)
              filas.forEach(f => { if (f.academicaId) marcar ? n.add(f.academicaId) : n.delete(f.academicaId) })
              return n
            }),
          } : undefined} />
        </>
      )}

      {confirmar && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[14px] bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[#17212B]">Resetear la última evaluación</h2>
            <p className={`mt-2 text-sm ${C.sec}`}>
              {confirmar === 'todos'
                ? `Se reiniciarán los intentos de la última evaluación de TODOS los alumnos de ${cursoActivo.tipoCurso} · Salón ${cursoActivo.salon || '—'} (${total}).`
                : `Se reiniciarán los intentos de la última evaluación de ${marcados.size} alumno(s) marcado(s).`}
              {' '}Podrán presentarla de nuevo con sus 3 intentos (incluso quien la había aprobado); el historial se conserva. ¿Continuar?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(null)} disabled={enviando}
                className="min-h-[44px] rounded-[14px] border border-[#E1E6EC] px-4 text-sm">Cancelar</button>
              <button type="button" onClick={resetear} disabled={enviando}
                className="min-h-[44px] rounded-[14px] bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {enviando ? 'Reseteando…' : 'Sí, resetear'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Leyenda />
    </>
  )
}
