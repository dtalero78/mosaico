'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission, Role } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { MENSAJE_FUERA_DE_VENTANA } from '@/lib/reporte-academico-ventana'

// `manual: false` = "Asistió", que se calcula solo con la asistencia marcada en
// cada sesión de la semana. Los otros 8 los marca el Guía aquí mismo.
const METRIC_COLS = [
  { key: 'asistio', label: 'Asistió', ico: '✅', grupo: 'HÁBITOS', manual: false },
  { key: 'puntual', label: 'Puntual', ico: '⏰', grupo: 'HÁBITOS', manual: true },
  { key: 'asignacion', label: 'Asignación', ico: '📋', grupo: 'HÁBITOS', manual: true },
  { key: 'dominio', label: 'Dominio', ico: '🎯', grupo: 'DESEMPEÑO', manual: true },
  { key: 'participo', label: 'Participó', ico: '🙌', grupo: 'DESEMPEÑO', manual: true },
  { key: 'desafio', label: 'Desafío', ico: '🏆', grupo: 'DESEMPEÑO', manual: true },
  { key: 'activo', label: 'Activo', ico: '⚡', grupo: 'ACTITUDES', manual: true },
  { key: 'respeto', label: 'Respeto', ico: '🤝', grupo: 'ACTITUDES', manual: true },
  { key: 'camara', label: 'Cámara', ico: '🎥', grupo: 'ACTITUDES', manual: true },
]

// Ciclo del óvalo al hacer clic: sin marcar → cumplió todas → algunas → no cumplió → sin marcar.
const CICLO = ['none', 'full', 'half', 'empty'] as const
const siguienteEstado = (actual?: string) => CICLO[(CICLO.indexOf((actual || 'none') as any) + 1) % CICLO.length]
const TITULO_ESTADO: Record<string, string> = {
  full: 'Cumplió todas', half: 'Cumplió algunas', empty: 'No cumplió', none: 'Sin marcar',
}

const fmtFecha = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('es', { day: '2-digit', month: 'short' }) } catch { return iso } }

/**
 * Filtros iniciales tomados de la URL, para poder enlazar a UN salón y semana
 * concretos — lo usa "RptAcademico sin gestión" en su columna Ir. Se lee una
 * sola vez al montar: después manda lo que el usuario elija en pantalla.
 */
function filtrosDeUrl() {
  const vacio = { guia: '', curso: '', salon: '', campaign: '', startDate: '', endDate: '' }
  if (typeof window === 'undefined') return vacio
  const sp = new URLSearchParams(window.location.search)
  return {
    guia: sp.get('guia') || '', curso: sp.get('curso') || '', salon: sp.get('salon') || '',
    campaign: sp.get('campaign') || '',
    startDate: sp.get('startDate') || '', endDate: sp.get('endDate') || '',
  }
}

export default function ReporteAcademicoPage() {
  const [f, setF] = useState(filtrosDeUrl)
  const [applied, setApplied] = useState(f)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [genIA, setGenIA] = useState<string | null>(null)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [savingNota, setSavingNota] = useState<string | null>(null)
  const [comentIA, setComentIA] = useState<Record<string, string>>({})
  const [individual, setIndividual] = useState<any>(null)
  const [enviando, setEnviando] = useState(false)
  // Criterios manuales por estudiante: { academicaId: { puntual: 'full', … } }
  const [criterios, setCriterios] = useState<Record<string, Record<string, string>>>({})
  const [dirty, setDirty] = useState(false)
  const [guardandoInforme, setGuardandoInforme] = useState(false)
  const [cerrando, setCerrando] = useState<'GUIA' | 'DEFINITIVO' | null>(null)
  const [confirmarCierre, setConfirmarCierre] = useState<'GUIA' | 'DEFINITIVO' | null>(null)

  // Envío disponible para todos MENOS los guías. `puedeEnviar` sólo es true cuando
  // el rol YA cargó y NO es guía → evita que el botón parpadee mientras carga.
  const { isRole, hasPermission, isLoading: permLoading } = usePermissions()
  const esGuia = isRole(Role.ADVISOR) // Role.ADVISOR = 'GUIA'
  const puedeEnviar = !permLoading && !esGuia
  const puedeRevisar = hasPermission(AcademicoPermission.REPORTE_ACADEMICO_REVISAR as any)
  const esSuperAdmin = isRole(Role.SUPER_ADMIN)

  // Selección (individual/masivo) + estado de la acción en bloque.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<{ tipo: string; done: number; total: number } | null>(null)

  const fetchData = useCallback(async (fl: typeof f) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(fl).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const res = await fetch(`/api/postgres/reports/academico/reporte-academico?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setData(res)
      // sincroniza estados editables
      const nt: Record<string, string> = {}, ci: Record<string, string> = {}, cr: Record<string, Record<string, string>> = {}
      ;(res.rows || []).forEach((r: any) => {
        nt[r.academicaId] = r.notaGuia || ''
        ci[r.academicaId] = r.comentarioIA || ''
        cr[r.academicaId] = { ...(r.criterios || {}) }
      })
      setNotas(nt); setComentIA(ci); setCriterios(cr); setDirty(false)
      // refleja filtros resueltos por el server
      // Se refleja lo que resolvió el servidor (incluida la campaña elegida por
      // defecto: la más reciente del curso/salón dentro del alcance del guía).
      setF(prev => ({
        ...prev,
        guia: res.guias?.length === 1 ? res.guias[0].id : prev.guia,
        curso: res.curso || prev.curso,
        salon: res.salon || prev.salon,
        campaign: res.campaign || '',
      }))
    } catch (e: any) { toast.error(e?.message || 'Error al cargar el reporte') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(applied) }, [applied, fetchData])

  // Aviso al salir con marcas sin guardar (el informe se guarda con el botón).
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const aplicar = () => setApplied({ ...f })
  const semanaActual = () => { const n = { ...f, startDate: '', endDate: '' }; setF(n); setApplied(n) }

  const generarIA = async (r: any, silent = false) => {
    setGenIA(r.academicaId)
    try {
      const res = await fetch('/api/postgres/reports/academico/reporte-academico/comentario-ia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaId: r.academicaId, numeroId: r.numeroId, salon: data.salon, curso: data.curso,
          semanaInicio: data.semanaInicio, nombre: r.nombre, sesSemana: r.sesSemana, metricas: r.metricas,
          asistenciaCursoPct: r.asistenciaCursoPct, progresoPct: r.progresoPct, comentariosSemana: r.comentariosSemana,
        }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      setComentIA(prev => ({ ...prev, [r.academicaId]: res.comentarioIA }))
      if (!silent) toast.success('Comentario IA generado')
    } catch (e: any) { if (!silent) toast.error(e?.message || 'Error al generar comentario'); throw e } finally { setGenIA(null) }
  }

  const guardarNota = async (r: any, silent = false) => {
    setSavingNota(r.academicaId)
    try {
      const res = await fetch('/api/postgres/reports/academico/reporte-academico', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaId: r.academicaId, numeroId: r.numeroId, salon: data.salon, curso: data.curso,
          semanaInicio: data.semanaInicio,
          notaGuia: notas[r.academicaId] || '',
          comentarioIA: comentIA[r.academicaId] || '',
        }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      if (!silent) toast.success('Guardado')
    } catch (e: any) { if (!silent) toast.error(e?.message || 'Error al guardar'); throw e } finally { setSavingNota(null) }
  }

  // Clic en un óvalo manual: avanza al siguiente estado del ciclo. Siempre editable,
  // haya o no sesiones esa semana (es la valoración del Guía, no un derivado).
  const ciclarCriterio = (academicaId: string, key: string) => {
    setCriterios(prev => {
      const fila = { ...(prev[academicaId] || {}) }
      const next = siguienteEstado(fila[key])
      if (next === 'none') delete fila[key]; else fila[key] = next
      return { ...prev, [academicaId]: fila }
    })
    setDirty(true)
  }

  // Guarda TODO el informe de la semana (criterios + comentario IA + actividad
  // individual) de todas las filas del salón en una sola petición.
  const guardarInforme = async (silent = false) => {
    if (!data?.salon || !data?.semanaInicio || rows.length === 0) return
    setGuardandoInforme(true)
    try {
      const res = await fetch('/api/postgres/reports/academico/reporte-academico', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salon: data.salon, semanaInicio: data.semanaInicio,
          items: rows.map((r: any) => ({
            academicaId: r.academicaId, numeroId: r.numeroId, curso: data.curso, campaign: data.campaign || undefined,
            criterios: criterios[r.academicaId] || {},
            comentarioIA: comentIA[r.academicaId] || '',
            notaGuia: notas[r.academicaId] || '',
          })),
        }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      setDirty(false)
      if (!silent) toast.success(`Informe guardado (${res.guardados} estudiante(s))`)
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar el informe')
      if (silent) throw e // al cerrar, si el guardado falla no se debe cerrar
    } finally { setGuardandoInforme(false) }
  }

  const enviarWhatsapp = async (r: any, silent = false) => {
    setEnviando(true)
    try {
      const res = await fetch('/api/postgres/reports/academico/reporte-academico/enviar-whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicaId: r.academicaId, curso: data.curso, salon: data.salon, guia: applied.guia || undefined, startDate: applied.startDate || undefined, endDate: applied.endDate || undefined }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      if (!silent) toast.success(`Enviado al apoderado (${res.to})`)
    } catch (e: any) { if (!silent) toast.error(e?.message || 'Error al enviar por WhatsApp'); throw e } finally { setEnviando(false) }
  }

  const rows = data?.rows || []

  // Estado del informe del salón. El backend valida lo mismo: esto sólo evita
  // mostrar controles que igualmente serían rechazados.
  //   BORRADOR     → el Guía edita y guarda las veces que quiera.
  //   CERRADO_GUIA → sólo quien tenga el permiso de revisar.
  //   DEFINITIVO   → sólo SUPER_ADMIN.
  const estadoCierre: 'BORRADOR' | 'CERRADO_GUIA' | 'DEFINITIVO' = data?.cierre?.estado || 'BORRADOR'
  // El Guía sólo gestiona de miércoles a domingo (hora de CHILE, que la manda el
  // servidor: el reloj del navegador puede estar en otro huso). Fuera de esos
  // días ve el informe, pero en solo lectura. A Coordinación no le aplica.
  const fueraDeVentana = esGuia && data?.enVentanaGuia === false

  const puedeEditar =
    fueraDeVentana ? false
      : estadoCierre === 'BORRADOR' ? true
        : estadoCierre === 'CERRADO_GUIA' ? puedeRevisar
          : esSuperAdmin
  const puedeCerrarGuia = !fueraDeVentana && estadoCierre === 'BORRADOR' && rows.length > 0
  const puedeCerrarDefinitivo = estadoCierre === 'CERRADO_GUIA' && puedeRevisar && rows.length > 0

  const cerrarInforme = async (accion: 'GUIA' | 'DEFINITIVO') => {
    if (!data?.curso || !data?.salon || !data?.campaign || !data?.semanaInicio) return
    setCerrando(accion)
    try {
      // Lo que esté sin guardar se guarda antes de cerrar, para no perder marcas.
      if (dirty) await guardarInforme(true)
      const res = await fetch('/api/postgres/reports/academico/reporte-academico/cerrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curso: data.curso, salon: data.salon, campaign: data.campaign,
          semanaInicio: data.semanaInicio, accion,
        }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(accion === 'GUIA' ? 'Informe cerrado y enviado a revisión' : 'Cierre definitivo aplicado')
      setConfirmarCierre(null)
      fetchData(applied)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cerrar el informe')
    } finally { setCerrando(null) }
  }

  // Helpers de selección + acción MASIVA (secuencial, con progreso).
  const toggleSel = (id: string) => setSeleccion(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleAll = () => setSeleccion(prev => prev.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((r: any) => r.academicaId)))
  const allSelected = rows.length > 0 && seleccion.size === rows.length
  const correrMasivo = async (tipo: string, fn: (r: any, silent?: boolean) => Promise<any>) => {
    const sel = rows.filter((r: any) => seleccion.has(r.academicaId))
    if (!sel.length) { toast.error('Selecciona al menos un estudiante'); return }
    setBulk({ tipo, done: 0, total: sel.length })
    let ok = 0, fail = 0
    for (let i = 0; i < sel.length; i++) {
      try { await fn(sel[i], true); ok++ } catch { fail++ }
      setBulk({ tipo, done: i + 1, total: sel.length })
    }
    setBulk(null)
    if (fail === 0) toast.success(`${tipo}: ${ok} completado(s)`)
    else toast.error(`${tipo}: ${ok} ok, ${fail} con error`)
  }
  const R = data?.resumen || {}
  const ov = individual ? individual : null

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.REPORTE_ACADEMICO_VER} showDefaultMessage>
        <style>{`
          .oval{display:inline-block;width:26px;height:17px;border-radius:99px;vertical-align:middle;border:2px solid transparent}
          .oval.full{background:linear-gradient(120deg,#6d28d9,#c026d3);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
          .oval.half{background:linear-gradient(90deg,#6d28d9 0 50%,transparent 50% 100%);border-color:#c026d3}
          .oval.empty{background:transparent;border-color:#dc2626}
          .oval.none{background:transparent;border:2px dashed #c9c2d6}
          .oval-btn{padding:4px;border-radius:99px;line-height:0;cursor:pointer;transition:background .12s}
          .oval-btn:hover:not(.is-disabled){background:#f3e8ff}
          .oval-btn:focus-visible{outline:2px solid #7e22ce;outline-offset:1px}
          .oval-btn.is-locked{cursor:not-allowed}
          .oval-btn.is-locked:hover{background:transparent}
          @media screen{.only-print{display:none}}
          @media print{
            nav,aside,.no-print,button,textarea{display:none !important}
            .print-header{display:flex !important}
            body{background:#fff}
            @page{size:landscape;margin:10mm}
            tr{page-break-inside:avoid}
            thead{display:table-header-group}
          }
          @media screen{.print-header{display:none}}
        `}</style>

        <div className="p-6 max-w-7xl mx-auto">
          {/* Print header */}
          <div className="print-header items-center justify-between border-b-2 border-purple-700 pb-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl grid place-items-center text-white font-extrabold" style={{ background: 'conic-gradient(from 210deg,#f59e0b,#c026d3,#6d28d9,#f59e0b)' }}>M</div>
              <div><div className="text-sm font-bold tracking-wide text-purple-800">MOSAICO · + que Matemáticas</div><div className="text-xs text-gray-500">Reporte Académico</div></div>
            </div>
            <div className="text-right text-sm">
              <div className="font-bold">{data ? `${fmtFecha(data.semanaInicio)} – ${fmtFecha(new Date(new Date(data.semanaFin + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10))}` : ''}</div>
              <div className="text-xs text-gray-500">{data?.curso} · Salón {data?.salon} · Guía: {data?.guiaNombre}</div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-1 no-print">
            <h1 className="text-2xl font-bold text-gray-900">Reporte Académico</h1>
            <PermissionGuard permission={AcademicoPermission.REPORTE_ACADEMICO_PDF}>
              <button onClick={() => window.print()} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">🖨 Imprimir / PDF</button>
            </PermissionGuard>
          </div>
          <p className="text-gray-500 mb-4 text-sm no-print">Consolidado semanal por salón. <b>Asistió</b> se calcula con la asistencia de las sesiones de la semana; los demás criterios los marca el Guía con clic (cumplió todas → algunas → no cumplió). Recuerda <b>Guardar informe</b>. No aplica a IMPULSA.</p>

          {/* Filtros */}
          <div className="no-print flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Guía</label>
              <select value={f.guia} onChange={e => { const n = { ...f, guia: e.target.value, curso: '', salon: '', campaign: '' }; setF(n); setApplied(n) }} disabled={(data?.guias?.length || 0) <= 1}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[170px] disabled:bg-gray-100">
                {(data?.guias?.length || 0) !== 1 && <option value="">Todas</option>}
                {(data?.guias || []).map((g: any) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Curso</label>
              <select value={f.curso} onChange={e => { const n = { ...f, curso: e.target.value, salon: '', campaign: '' }; setF(n); setApplied(n) }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[120px]">
                {(data?.cursos || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Salón</label>
              <select value={f.salon} onChange={e => { const n = { ...f, salon: e.target.value, campaign: '' }; setF(n); setApplied(n) }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[110px]">
                {(data?.salones || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {/* El mismo salón existe en varias campañas, cada una con su Guía y sus
                alumnos: sin este filtro se mezclaban todas. */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase">Campaña</label>
              <select value={f.campaign} onChange={e => { const n = { ...f, campaign: e.target.value }; setF(n); setApplied(n) }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[160px]">
                {(data?.campaigns || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* El Guía no elige semana: siempre trabaja la actual. Los controles
                se ocultan, y el servidor además ignora las fechas si llegaran. */}
            {!esGuia && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase">Semana desde</label>
                  <input type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 uppercase">Hasta</label>
                  <input type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </>
            )}
            <div className="flex-1" />
            <button onClick={aplicar} className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-medium hover:bg-purple-800">Aplicar</button>
            {!esGuia && (
              <button onClick={semanaActual} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Semana actual</button>
            )}
          </div>

          {/* Lunes y martes: el informe se ve pero no se toca. */}
          {fueraDeVentana && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">Informe en solo lectura</p>
              <p className="text-sm text-amber-700 mt-0.5">{MENSAJE_FUERA_DE_VENTANA}</p>
            </div>
          )}

          {/* Resumen */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Estudiantes</div><div className="text-2xl font-extrabold">{R.estudiantes ?? 0}</div><div className="text-xs text-gray-500">del salón</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Asistencia semana</div><div className="text-2xl font-extrabold text-fuchsia-600">{R.asistidasSemana ?? 0} / {R.totalSesSemana ?? 0}</div><div className="text-xs text-gray-500">{R.asistenciaSemanaPct ?? 0}%</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Asistencia del curso</div><div className="text-2xl font-extrabold">{R.asistenciaCursoPct ?? 0}%</div><div className="text-xs text-gray-500">acumulada</div></div>
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Progreso del curso</div><div className="text-2xl font-extrabold">{R.progresoPct ?? 0}%</div><div className="text-xs text-gray-500">promedio del salón</div></div>
          </div>

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-sm">Métricas de la semana</h3>
              <div className="flex flex-wrap items-center gap-2">
                {/* Estado del informe de la semana */}
                {estadoCierre === 'CERRADO_GUIA' && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-amber-100 text-amber-700"
                    title={data?.cierre?.cerradoGuiaPor ? `Cerrado por ${data.cierre.cerradoGuiaPor}` : ''}>
                    🔒 Cerrado por el Guía — en revisión
                  </span>
                )}
                {estadoCierre === 'DEFINITIVO' && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-gray-200 text-gray-700"
                    title={data?.cierre?.cerradoAdminPor ? `Cierre definitivo por ${data.cierre.cerradoAdminPor}` : ''}>
                    ✅ Cierre definitivo
                  </span>
                )}
                {estadoCierre === 'BORRADOR' && (
                  <span className="text-xs text-gray-500">Asistió es automático; los demás se marcan con clic</span>
                )}
                {dirty && <span className="no-print text-xs font-semibold text-amber-600">● Cambios sin guardar</span>}

                {puedeEditar && (
                  <button
                    type="button" onClick={() => guardarInforme()} disabled={guardandoInforme || rows.length === 0}
                    className="no-print px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-40"
                  >
                    {guardandoInforme ? 'Guardando…' : '💾 Guardar informe'}
                  </button>
                )}
                {puedeCerrarGuia && (
                  <button
                    type="button" onClick={() => setConfirmarCierre('GUIA')} disabled={!!cerrando}
                    title="Al cerrar ya no podrás modificar el informe de esta semana"
                    className="no-print px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    🔒 Cerrar y enviar a revisión
                  </button>
                )}
                {puedeCerrarDefinitivo && (
                  <button
                    type="button" onClick={() => setConfirmarCierre('DEFINITIVO')} disabled={!!cerrando}
                    title="Cierre definitivo: después nadie podrá modificarlo"
                    className="no-print px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    ✅ Guardar definitivo
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky left-0 bg-white text-left text-xs font-semibold text-gray-600 px-4 pb-3 pt-2 align-bottom border-b border-gray-200 min-w-[160px]">Estudiante</th>
                    <th colSpan={3} className="text-[10px] uppercase tracking-wide text-purple-700 font-bold text-center pt-2 pb-1 border-b border-gray-100">Hábitos</th>
                    <th colSpan={3} className="text-[10px] uppercase tracking-wide text-fuchsia-600 font-bold text-center pt-2 pb-1 border-b border-gray-100">Desempeño</th>
                    <th colSpan={3} className="text-[10px] uppercase tracking-wide text-cyan-700 font-bold text-center pt-2 pb-1 border-b border-gray-100">Actitudes</th>
                    <th rowSpan={2} className="text-xs font-semibold text-gray-600 text-center px-2 pb-3 pt-2 align-bottom border-b border-gray-200">Sesiones</th>
                  </tr>
                  <tr>
                    {METRIC_COLS.map(m => (
                      <th key={m.key} title={m.label} className="text-[11px] text-gray-500 font-medium text-center px-1 pb-3 border-b-2 border-gray-200" style={{ width: 46 }}>
                        <span className="block text-[15px] mb-0.5">{m.ico}</span>{m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} className="text-center text-sm text-gray-400 py-10">Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={11} className="text-center text-sm text-gray-400 py-10">{data?.sinCurso ? 'Selecciona curso y salón.' : 'Sin estudiantes en este salón / semana.'}</td></tr>
                  ) : rows.map((r: any) => (
                    <tr key={r.academicaId} className="hover:bg-purple-50/40">
                      <td className="sticky left-0 bg-white px-4 py-3 border-b border-gray-100">
                        <div className="flex flex-col"><b className="text-[13.5px] text-gray-900">{r.nombre}</b><span className="text-[11.5px] text-gray-500">ID {r.numeroId} · {r.plataforma}</span></div>
                      </td>
                      {METRIC_COLS.map(m => {
                        // Asistió: automático (viene de las sesiones), no se toca.
                        if (!m.manual) return (
                          <td key={m.key} className="text-center py-3 border-b border-gray-100">
                            <span className={`oval ${r.metricas[m.key]?.estado || 'none'}`} title={`${r.metricas[m.key]?.cumplidas || 0}/${r.sesSemana} sesiones asistidas`}></span>
                          </td>
                        )
                        // Los 8 restantes los marca SIEMPRE el Guía, haya o no
                        // sesiones registradas esa semana: es su valoración, no un
                        // derivado de la asistencia.
                        const estado = criterios[r.academicaId]?.[m.key] || 'none'
                        return (
                          <td key={m.key} className="text-center py-3 border-b border-gray-100">
                            <button
                              type="button"
                              disabled={!puedeEditar}
                              onClick={() => ciclarCriterio(r.academicaId, m.key)}
                              title={puedeEditar
                                ? `${m.label}: ${TITULO_ESTADO[estado]} — clic para cambiar`
                                : `${m.label}: ${TITULO_ESTADO[estado]} (informe cerrado)`}
                              aria-label={`${m.label} de ${r.nombre}: ${TITULO_ESTADO[estado]}`}
                              className={`oval-btn ${puedeEditar ? '' : 'is-locked'}`}
                            >
                              <span className={`oval ${estado}`}></span>
                            </button>
                          </td>
                        )
                      })}
                      <td className="text-center py-3 border-b border-gray-100"><span className={`font-extrabold text-[15px] ${r.sesSemana === 0 ? 'text-red-600' : ''}`}>{r.sesSemana}<small className="text-gray-500 font-semibold text-[11px]">/{r.sesSemana || 2}</small></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 items-center text-xs text-gray-500 px-4 py-3">
              <span className="inline-flex items-center gap-2"><span className="oval full"></span> Cumplió todas</span>
              <span className="inline-flex items-center gap-2"><span className="oval half"></span> Cumplió algunas</span>
              <span className="inline-flex items-center gap-2"><span className="oval empty"></span> No cumplió</span>
              <span className="inline-flex items-center gap-2"><span className="oval none"></span> Sin marcar / sin sesión</span>
            </div>
          </div>

          {/* Valoración Guía — comentario IA (editable) + actividad individual */}
          {rows.length > 0 && (
            <>
              <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-bold">Valoración Guía</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-purple-600" />
                    Seleccionar todos
                  </label>
                  <span className="text-xs text-gray-500">{seleccion.size} seleccionado(s)</span>
                  <button type="button" onClick={() => correrMasivo('Generar IA', generarIA)} disabled={!puedeEditar || !!bulk || seleccion.size === 0}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-40">✦ Generar IA</button>
                  <button type="button" onClick={() => correrMasivo('Guardar', guardarNota)} disabled={!puedeEditar || !!bulk || seleccion.size === 0}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-40">Guardar valoración</button>
                  {puedeEnviar && (
                    <button type="button" onClick={() => correrMasivo('Enviar', enviarWhatsapp)} disabled={!!bulk || seleccion.size === 0}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">📲 Enviar</button>
                  )}
                  {bulk && <span className="text-xs text-purple-700 font-medium">{bulk.tipo}: {bulk.done}/{bulk.total}…</span>}
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
                {rows.map((r: any) => (
                  <div key={r.academicaId} className="grid grid-cols-1 md:grid-cols-[170px_1fr_1fr]">
                    <div className="px-4 py-3 border-r border-gray-100">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={seleccion.has(r.academicaId)} onChange={() => toggleSel(r.academicaId)}
                          className="no-print mt-1 accent-purple-600 shrink-0" title="Seleccionar" />
                        <div className="min-w-0">
                          <div className="flex flex-col"><b className="text-[13.5px]">{r.nombre}</b><span className="text-[11.5px] text-gray-500">{r.sesSemana} sesión(es) · {r.asistenciaCursoPct}% curso</span></div>
                          <PermissionGuard permission={AcademicoPermission.REPORTE_ACADEMICO_INDIVIDUAL}>
                            <button onClick={() => setIndividual({ ...r, comentarioIA: comentIA[r.academicaId] || r.comentarioIA, notaGuia: notas[r.academicaId] ?? r.notaGuia })}
                              className="no-print mt-2 text-xs font-semibold text-purple-700 hover:text-purple-900">📄 Informe individual</button>
                          </PermissionGuard>
                        </div>
                      </div>
                    </div>
                    <div className="px-4 py-3 border-r border-gray-100">
                      <div className="flex items-center gap-2 mb-1"><span className="text-[10.5px] uppercase tracking-wide text-gray-500 font-semibold">Comentario</span><span className="text-[9.5px] bg-fuchsia-50 text-fuchsia-600 rounded-full px-2 py-0.5 font-bold">✦ IA</span></div>
                      {/* Editable: se genera con IA y el Guía puede ajustarlo o completarlo. */}
                      <textarea
                        value={comentIA[r.academicaId] ?? ''}
                        onChange={e => { setComentIA(p => ({ ...p, [r.academicaId]: e.target.value })); setDirty(true) }}
                        readOnly={!puedeEditar}
                        placeholder="— sin generar — - genéralo con IA o escríbelo aquí…"
                        className="w-full min-h-[76px] resize-y border border-gray-300 rounded-lg px-3 py-2 text-[13px]"
                      />
                      {/* En impresión el textarea no se ve bien: se imprime el texto. */}
                      <p className="only-print text-[13px] text-gray-800 whitespace-pre-wrap">{comentIA[r.academicaId]}</p>
                      <button onClick={() => generarIA(r)} disabled={!puedeEditar || genIA === r.academicaId} className="no-print mt-1.5 text-xs font-semibold text-purple-700 hover:text-purple-900 disabled:opacity-50">
                        {genIA === r.academicaId ? 'Generando…' : (comentIA[r.academicaId] ? '✦ Regenerar' : '✦ Generar con IA')}
                      </button>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[10.5px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Actividades de Práctica Individual</div>
                      <textarea value={notas[r.academicaId] ?? ''} onChange={e => { setNotas(p => ({ ...p, [r.academicaId]: e.target.value })); setDirty(true) }}
                        readOnly={!puedeEditar}
                        placeholder="Escribe las actividades de práctica individual de la semana…" className="w-full min-h-[76px] resize-y border border-gray-300 rounded-lg px-3 py-2 text-[13px]" />
                      <p className="only-print text-[13px] text-gray-800 whitespace-pre-wrap">{notas[r.academicaId]}</p>
                      <button onClick={() => guardarNota(r)} disabled={!puedeEditar || savingNota === r.academicaId} className="no-print mt-1.5 text-xs font-semibold text-purple-700 hover:text-purple-900 disabled:opacity-50">
                        {savingNota === r.academicaId ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Confirmación del cierre — es irreversible para quien lo hace */}
          {confirmarCierre && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 no-print" onClick={() => !cerrando && setConfirmarCierre(null)}>
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {confirmarCierre === 'GUIA' ? 'Cerrar informe y enviar a revisión' : 'Aplicar cierre definitivo'}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  {data?.curso} · Salón {data?.salon} · {data?.campaign} · semana del {data?.semanaInicio ? fmtFecha(data.semanaInicio) : ''}
                </p>
                <div className={`rounded-lg p-3 mb-4 text-sm border ${
                  confirmarCierre === 'GUIA' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {confirmarCierre === 'GUIA' ? (
                    <>Después de cerrarlo <b>ya no podrás modificar</b> el informe de esta semana. Quedará a la espera de la revisión.</>
                  ) : (
                    <>Este es el <b>cierre definitivo</b>. Después nadie podrá modificar el informe de esta semana.</>
                  )}
                  {dirty && <span className="block mt-1">Los cambios sin guardar se guardarán antes de cerrar.</span>}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmarCierre(null)} disabled={!!cerrando}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
                  <button type="button" onClick={() => cerrarInforme(confirmarCierre)} disabled={!!cerrando}
                    className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 font-medium ${
                      confirmarCierre === 'GUIA' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}>
                    {cerrando ? 'Cerrando…' : confirmarCierre === 'GUIA' ? 'Cerrar informe' : 'Cerrar definitivo'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal informe individual */}
          {ov && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto no-print" onClick={() => setIndividual(null)}>
              <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full my-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <h3 className="font-bold text-gray-900">Informe individual</h3>
                  <button onClick={() => setIndividual(null)} title="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
                </div>
                <div className="p-5">
                  <div className="text-lg font-extrabold">{ov.nombre}</div>
                  <div className="text-xs text-gray-500 mb-3">ID {ov.numeroId} · {ov.plataforma} · Módulo {ov.nivel} · {ov.step}</div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="border border-gray-200 rounded-lg p-2.5 text-center"><div className="text-[10px] uppercase text-gray-500 font-semibold">Sesiones</div><div className="text-xl font-extrabold">{ov.sesSemana}</div></div>
                    <div className="border border-gray-200 rounded-lg p-2.5 text-center"><div className="text-[10px] uppercase text-gray-500 font-semibold">Asist. curso</div><div className="text-xl font-extrabold text-fuchsia-600">{ov.asistenciaCursoPct}%</div></div>
                    <div className="border border-gray-200 rounded-lg p-2.5 text-center"><div className="text-[10px] uppercase text-gray-500 font-semibold">Progreso</div><div className="text-xl font-extrabold">{ov.progresoPct}%</div></div>
                  </div>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-4">
                    {METRIC_COLS.map(m => (
                      <div key={m.key} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-gray-700">{m.ico} {m.label}</span>
                        <span className="flex items-center gap-2"><span className={`oval ${ov.metricas[m.key]?.estado || 'none'}`}></span><span className="text-xs text-gray-500 tabular-nums">{ov.metricas[m.key]?.cumplidas || 0}/{ov.sesSemana}</span></span>
                      </div>
                    ))}
                  </div>
                  {/* Base del informe: SIEMPRE se muestran ambos comentarios (IA + Docente),
                      con placeholder si aún no hay contenido. */}
                  <div className="mb-3">
                    <div className="text-[10.5px] uppercase text-gray-500 font-semibold mb-1">Comentario IA</div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{ov.comentarioIA || <span className="text-gray-400">— sin generar —</span>}</p>
                  </div>
                  <div className="mb-3">
                    <div className="text-[10.5px] uppercase text-gray-500 font-semibold mb-1">Comentario del Docente</div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{ov.notaGuia || <span className="text-gray-400">— sin valoración —</span>}</p>
                  </div>
                  {puedeEnviar && (
                    <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                      {ov.apoderadoTelefono ? <>Se enviará el PDF de este informe al apoderado <b>{ov.apoderado || ''}</b> (••••{String(ov.apoderadoTelefono).slice(-4)}).</> : <>⚠ El apoderado no tiene teléfono registrado; no se puede enviar por WhatsApp.</>}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-100">
                  <button onClick={() => setIndividual(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cerrar</button>
                  {puedeEnviar && (
                    <button onClick={() => enviarWhatsapp(ov)} disabled={enviando || !ov.apoderadoTelefono}
                      className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                      {enviando ? 'Enviando…' : '📲 Enviar por WhatsApp'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
