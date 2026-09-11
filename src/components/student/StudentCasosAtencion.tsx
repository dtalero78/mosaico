'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowTopRightOnSquareIcon, PlusIcon } from '@heroicons/react/24/outline'
import { TZ_OPERACION } from '@/lib/cursos-campaign'
import {
  ESTADO_ABIERTO, ESTADO_LABEL, estadoLabel, cierraElCaso, tipoCasoLabel,
  ESTADOS_POR_AREA, AREA_PESTANA, AREA_COLOR,
} from '@/lib/casos-atencion-estados'
import type { EstadoCaso, AreaCaso } from '@/lib/casos-atencion-estados'

/**
 * Pestaña "Casos Atención" de la ficha del estudiante.
 *
 * Orden, de arriba abajo: cabecera con el selector de estado, reportes (el
 * contenido del caso, primero), indicadores, contexto administrativo, gestión de
 * contacto, acuerdo, seguimiento e histórico.
 *
 * Lo único editable es la gestión: los reportes vienen del panel del guía y son
 * inmutables, y el contexto administrativo se deriva de sus fuentes.
 *
 * El **Seguimiento** es la bitácora del caso y se arma fusionando lo que ya
 * queda escrito en cada sitio (reportes, cambios de estado, intentos de
 * contacto) con las notas de gestión, que son lo único con columna propia.
 */

const CANALES = [
  { id: 'LLAMADA', label: 'Llamada' },
  { id: 'WHATSAPP', label: 'WhatsApp' },
  { id: 'EMAIL', label: 'Email' },
]
const RESULTADOS = [
  { id: 'CONTESTO', label: 'Contestó' },
  { id: 'NO_CONTESTO', label: 'No contestó' },
  { id: 'RESPONDIO', label: 'Respondió' },
  { id: 'SIN_RESPUESTA', label: 'Sin respuesta' },
  { id: 'PENDIENTE', label: 'Pendiente' },
]
/** Verde = hubo respuesta; rojo/ámbar = no la hubo. */
const RESULTADO_COLOR: Record<string, string> = {
  CONTESTO: 'bg-emerald-100 text-emerald-700',
  RESPONDIO: 'bg-emerald-100 text-emerald-700',
  NO_CONTESTO: 'bg-red-100 text-red-700',
  SIN_RESPUESTA: 'bg-amber-100 text-amber-700',
  PENDIENTE: 'bg-gray-100 text-gray-600',
}
const REINCIDENCIA_COLOR: Record<string, string> = {
  BAJA: 'text-emerald-700', MEDIA: 'text-amber-700', ALTA: 'text-red-700',
}

/** Cómo se pinta cada clase de movimiento en la bitácora. */
const MOV_META: Record<string, { label: string; punto: string; chip: string }> = {
  REPORTE:  { label: 'Reportado',   punto: 'bg-amber-400',   chip: 'bg-amber-100 text-amber-700' },
  ESTADO:   { label: 'Movimiento',  punto: 'bg-primary-500', chip: 'bg-primary-100 text-primary-700' },
  CONTACTO: { label: 'Contacto',    punto: 'bg-sky-400',     chip: 'bg-sky-100 text-sky-700' },
  NOTA:     { label: 'Nota',        punto: 'bg-gray-400',    chip: 'bg-gray-100 text-gray-600' },
}

const CANAL_LABEL: Record<string, string> = {
  LLAMADA: 'Llamada', WHATSAPP: 'WhatsApp', EMAIL: 'Email',
}

/** El titular de cada entrada de la bitácora, según de qué movimiento se trate. */
function tituloMovimiento(m: any): string {
  if (m.tipo === 'REPORTE') {
    return m.meta?.abrioCaso ? 'Reportado — abrió el caso' : 'Nuevo reporte'
  }
  if (m.tipo === 'ESTADO') {
    if (m.meta?.cierra) return `Cerrado — ${estadoLabel(m.meta.estadoNuevo)}`
    return `Pasa a ${estadoLabel(m.meta?.estadoNuevo)}`
  }
  if (m.tipo === 'CONTACTO') {
    const canal = CANAL_LABEL[m.meta?.canal] || m.meta?.canal || ''
    return `${canal} · intento ${m.meta?.intento ?? '—'}`
  }
  return 'Nota de seguimiento'
}

// Los timestamps viajan en UTC y se muestran en la hora de la plataforma.
const TZ = TZ_OPERACION
const fmt = (v: any, conHora = true) => {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-CL', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export default function StudentCasosAtencion({ studentId }: { studentId: string }) {
  const [casos, setCasos] = useState<any[]>([])
  const [casoId, setCasoId] = useState<string | null>(null)
  const [d, setD] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)

  // Borradores de la gestión editable.
  const [acuerdo, setAcuerdo] = useState('')
  const [fechaCompromiso, setFechaCompromiso] = useState('')
  const [responsable, setResponsable] = useState('')
  const [nuevoEstado, setNuevoEstado] = useState(ESTADO_ABIERTO)
  const [agregando, setAgregando] = useState<string | null>(null)   // canal
  const [resultado, setResultado] = useState('CONTESTO')
  // Bitácora: la nota que se está escribiendo y el comentario obligatorio con
  // que se confirma un cambio de estado.
  const [nota, setNota] = useState('')
  const [motivoCambio, setMotivoCambio] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const cargarLista = useCallback(async () => {
    const r = await fetch(`/api/postgres/casos-atencion?academicaId=${encodeURIComponent(studentId)}`, { cache: 'no-store' })
    const j = await r.json()
    if (j?.success) {
      setCasos(j.casos || [])
      setCasoId(prev => prev && (j.casos || []).some((c: any) => c._id === prev) ? prev : j.casoInicial)
    }
    return j
  }, [studentId])

  const cargarDetalle = useCallback(async (id: string) => {
    const r = await fetch(`/api/postgres/casos-atencion/${encodeURIComponent(id)}`, { cache: 'no-store' })
    const j = await r.json()
    if (!j?.success) { setMsg({ t: 'err', x: j?.error || 'No se pudo cargar el caso.' }); return }
    setD(j)
    setAcuerdo(j.caso.acuerdo || '')
    setFechaCompromiso(j.caso.fechaCompromiso ? String(j.caso.fechaCompromiso).slice(0, 10) : '')
    setResponsable(j.caso.responsable || '')
    setNuevoEstado(j.caso.estado)
  }, [])

  useEffect(() => {
    let vivo = true
    setLoading(true)
    cargarLista().finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [cargarLista])

  useEffect(() => { if (casoId) cargarDetalle(casoId) }, [casoId, cargarDetalle])

  // La reincidencia con IA se calcula en segundo plano, así que la primera
  // lectura puede llegar sin ella. Se reintenta UNA vez a los 8 s para que la
  // ficha no se quede en "Calculando…" hasta que alguien refresque a mano.
  // (El primer caso del alumno no pasa por aquí: el servidor lo resuelve al
  // vuelo, porque sin antecedentes la reincidencia es BAJA por definición.)
  useEffect(() => {
    if (!casoId || !d || d.caso?.reincidenciaNivel) return
    const t = setTimeout(() => { cargarDetalle(casoId) }, 8000)
    return () => clearTimeout(t)
  }, [casoId, d, cargarDetalle])

  const patch = async (body: any, okMsg?: string) => {
    if (!casoId) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/postgres/casos-atencion/${encodeURIComponent(casoId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!j?.success) { setMsg({ t: 'err', x: j?.error || 'No se pudo guardar.' }); return false }
      setMsg({ t: 'ok', x: okMsg || j.message || 'Guardado.' })
      await cargarDetalle(casoId)
      await cargarLista()
      return true
    } catch (e: any) {
      setMsg({ t: 'err', x: e?.message || 'Error de red.' })
      return false
    } finally { setBusy(false) }
  }

  /**
   * Guarda la gestión. Si el estado cambió NO se guarda de una: se abre la
   * confirmación, porque todo movimiento del caso exige un comentario que
   * explique por qué — es lo que queda en la bitácora.
   */
  const guardar = async () => {
    if (!casoId || !d) return
    if (nuevoEstado !== d.caso.estado) { setMotivoCambio(''); setConfirmando(true); return }
    await patch({ acuerdo, fechaCompromiso: fechaCompromiso || null, responsable })
  }

  /**
   * Confirma el cambio de estado. El acuerdo se guarda ANTES porque cerrar exige
   * que ya esté persistido (R5), así que el orden importa; si el guardado falla
   * no se intenta el cambio.
   */
  const confirmarCambio = async () => {
    if (!casoId || !d || !motivoCambio.trim()) return
    const ok = await patch({
      acuerdo, fechaCompromiso: fechaCompromiso || null, responsable,
    }, 'Gestión guardada, aplicando el cambio…')
    if (!ok) return
    const hecho = await patch({ estado: nuevoEstado, motivo: motivoCambio.trim() })
    if (hecho) { setConfirmando(false); setMotivoCambio('') }
  }

  /** Agrega una nota a la bitácora (no cambia el estado del caso). */
  const agregarNota = async () => {
    if (!nota.trim()) return
    const ok = await patch({ nota: nota.trim() }, 'Nota agregada al seguimiento.')
    if (ok) setNota('')
  }

  if (loading) {
    return <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando casos…</div>
  }

  if (!casos.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
        <h3 className="text-lg font-semibold text-gray-900">Sin casos de atención</h3>
        <p className="mt-1 text-sm text-gray-500">
          Los casos se abren cuando un guía reporta una situación desde su panel, en la sesión.
        </p>
      </div>
    )
  }

  if (!d) return <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando el caso…</div>

  const c = d.caso
  // Vivo mientras no haya cerrado: un caso asignado a un área se sigue gestionando
  // aunque su estado ya no sea EN_GESTION.
  const abierto = !cierraElCaso(c.estado)
  const area = (c.area || null) as AreaCaso | null
  // Lo que ofrece el desplegable: si aún no tiene área, sólo puede seguir abierto
  // o cerrarse — asignarla es cosa de la bandeja de Servicio, no de aquí.
  const opciones: EstadoCaso[] = area
    ? ESTADOS_POR_AREA[area]
    : [ESTADO_ABIERTO, 'RESUELTO']
  // Intentos por canal, para la grilla canal × intento.
  // La bitácora llega ya fusionada y ordenada del servidor (reportes + cambios
  // de estado + contactos + notas): aquí sólo se pinta.
  const timeline: any[] = Array.isArray(d.timeline) ? d.timeline : []
  const ultimoMov = timeline.length ? timeline[timeline.length - 1] : null
  const porCanal = (canal: string) => d.contactos.filter((x: any) => x.canal === canal)
  const maxIntentos = Math.max(1, ...CANALES.map(k => porCanal(k.id).length))
  const conRespuesta = d.contactos.filter((x: any) => ['CONTESTO', 'RESPONDIO'].includes(x.resultado)).length

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`p-3 rounded-md text-sm ${msg.t === 'ok'
          ? 'bg-green-50 border border-green-200 text-green-700'
          : 'bg-red-50 border border-red-200 text-red-700'}`}>{msg.x}</div>
      )}

      {/* Selector cuando el alumno tiene varios casos (R3) */}
      {casos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {casos.map(x => (
            <button key={x._id} type="button" onClick={() => setCasoId(x._id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${x._id === casoId
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              {x.codigo} · {tipoCasoLabel(x.tema)}
              {x.estado !== ESTADO_ABIERTO && <span className="opacity-70"> (cerrado)</span>}
              {x.sinLeer > 0 && <span className="ml-1 inline-block w-2 h-2 rounded-full bg-red-500" title={`${x.sinLeer} reporte(s) sin leer`} />}
            </button>
          ))}
        </div>
      )}

      {/* 1 · Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-gray-500">Casos de atención</p>
          <h2 className="text-2xl font-bold text-gray-900">Caso {c.codigo}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {c.alumno} · {c.curso} {c.campaign} · Salón {c.salon || '—'} · {c.horarioCurso || '—'}
          </p>
          {/* R3: dos gestores no deben contactar a la misma apoderada sin saberlo. */}
          {d.otrosCasosAbiertos.length > 0 && (
            <p className="text-sm mt-1">
              {d.otrosCasosAbiertos.map((o: any) => (
                <button key={o._id} type="button" onClick={() => setCasoId(o._id)}
                  className="text-primary-600 hover:underline mr-3">
                  ↗ Este alumno tiene otro caso abierto: {tipoCasoLabel(o.tema)}
                </button>
              ))}
            </p>
          )}
        </div>
        <div className="min-w-[280px]">
          {/* Indicador: dónde está el caso. ASIGNADO nombra la bandeja que lo tiene;
              EN GESTIÓN es el que sigue en Servicio; CERRADO, el que ya terminó. */}
          <div className="flex items-center gap-2 mb-2">
            {!abierto ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-green-100 text-green-800">
                CERRADO
              </span>
            ) : area ? (
              <>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-700">
                  ASIGNADO
                </span>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${AREA_COLOR[area]}`}>
                  {AREA_PESTANA[area]}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-800">
                EN GESTIÓN
              </span>
            )}
          </div>
          <select value={nuevoEstado} onChange={e => setNuevoEstado(e.target.value as EstadoCaso)} disabled={!abierto || busy}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
            {opciones.map(e => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
          </select>
          {!abierto && (
            <p className="text-xs text-gray-500 mt-1">
              Cerrado el {fmt(c.cerradoEn, false)} — solo lectura.
            </p>
          )}
        </div>
      </div>

      {/* 2 · Reportes: el contenido del caso, primero */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Reportes en gestión</h3>
          <span className="text-xs text-gray-400">alimentado desde el panel del guía · no editable</span>
        </div>
        <ul className="space-y-4">
          {d.reportes.map((r: any) => (
            <li key={r._id} className="border-l-2 border-primary-300 pl-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-500">{fmt(r._createdDate)}</span>
                <span className="text-gray-800">{r.guiaNombre || '—'}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
                  {tipoCasoLabel(r.tema)}
                </span>
                {r.abrioCaso
                  ? <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">Abrió el caso</span>
                  : <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">Nuevo</span>}
              </div>
              <p className="text-gray-800 mt-1 whitespace-pre-wrap">{r.texto}</p>
              {r.sesionDia && (
                <p className="text-sm text-primary-600 mt-1">
                  ↗ Sesión del {fmt(r.sesionDia, false)}{r.sesionSalon ? `, Salón ${r.sesionSalon}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 3 · Indicadores. Cuatro en una fila y compactos: el detalle de cada uno
          vive más abajo (la bitácora completa, el histórico), así que aquí basta
          con el número y una línea de contexto. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Caso del alumno</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5 leading-tight">N.º {c.numeroCaso}</p>
          <p className="text-[11px] text-gray-400 mt-1 truncate" title={c.codigo || ''}>{c.codigo || ''}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Reportes acumulados</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5 leading-tight">
            {d.reportesEnEsteCaso} <span className="text-sm font-normal text-gray-400">de {d.reportesTotalesAlumno}</span>
          </p>
          <p className="text-[11px] text-gray-400 mt-1 truncate">Tipo: {tipoCasoLabel(c.tema) || '—'}</p>
        </div>
        {/* Seguimiento: cuánto se ha movido el caso y qué fue lo último. El
            recorrido completo está en la bitácora, más abajo. */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Seguimiento</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5 leading-tight">
            {timeline.length} <span className="text-sm font-normal text-gray-400">movim.</span>
          </p>
          {ultimoMov ? (
            <p className="text-[11px] text-gray-500 mt-1 leading-snug">
              <span className="block truncate" title={tituloMovimiento(ultimoMov)}>{tituloMovimiento(ultimoMov)}</span>
              <span className="block text-gray-400 truncate">
                {fmt(ultimoMov.fecha, false)}{ultimoMov.autor ? ` · ${ultimoMov.autor}` : ''}
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-gray-400 mt-1">Sin movimientos</p>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            Reincidencia
            <span className="px-1 py-px rounded text-[9px] font-semibold bg-indigo-100 text-indigo-700">IA</span>
          </p>
          <p className={`text-2xl font-bold mt-0.5 leading-tight ${REINCIDENCIA_COLOR[c.reincidenciaNivel] || 'text-gray-400'}`}>
            {c.reincidenciaNivel ? c.reincidenciaNivel[0] + c.reincidenciaNivel.slice(1).toLowerCase() : 'Calculando…'}
          </p>
          <p className="text-[11px] text-gray-500 mt-1 leading-snug">
            <span className="block truncate" title={c.reincidenciaPatron || ''}>
              {c.reincidenciaPatron ? `Patrón: ${c.reincidenciaPatron}` : 'Se calcula al abrir el caso'}
            </span>
            {c.reincidenciaFactores?.resumen && (
              <span className="block text-gray-400 truncate" title={c.reincidenciaFactores.resumen}>
                {c.reincidenciaFactores.resumen}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* 4 · Contexto administrativo — derivado (R10) */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">
          Contexto administrativo <span className="text-sm font-normal text-gray-400">· solo lectura</span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>
            <p className="text-gray-500 text-xs">Contrato</p>
            <p className="text-primary-600">{c.contrato || '—'}</p>
          </div>
          <div><p className="text-gray-500 text-xs">Apoderado</p><p className="text-gray-800">{c.apoderado || '—'}</p></div>
          <div><p className="text-gray-500 text-xs">Asesor comercial</p><p className="text-gray-800">{c.asesorComercial || '—'}</p></div>
          <div><p className="text-gray-500 text-xs">Ejecutivo finanzas</p><p className="text-gray-800">{c.ejecutivoFinanzas || '—'}</p></div>
          <div>
            <p className="text-gray-500 text-xs">Estado finanzas</p>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
              String(c.estadoFinanzas || '').toLowerCase() === 'normal'
                ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {c.estadoFinanzas || 'sin dato'}
              {c.numeroCuotas ? ` · ${c.cuotasPagadas || 0}/${c.numeroCuotas} cuotas` : ''}
            </span>
          </div>
        </div>
      </section>

      {/* 5 · Gestión de contacto: grilla canal × intento (R8) */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Gestión de contacto</h3>
          <span className="text-xs text-gray-400">{conRespuesta} de {d.contactos.length} intentos con respuesta</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs">
                <th className="text-left font-medium py-1 pr-4">&nbsp;</th>
                {Array.from({ length: maxIntentos }, (_, i) => (
                  <th key={i} className="text-left font-medium py-1 pr-4">Intento {i + 1}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {CANALES.map(k => {
                const items = porCanal(k.id)
                return (
                  <tr key={k.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 text-gray-700">{k.label}</td>
                    {Array.from({ length: maxIntentos }, (_, i) => {
                      const it = items[i]
                      return (
                        <td key={i} className="py-2 pr-4 align-top">
                          {it ? (
                            <>
                              <div className="text-gray-700 whitespace-nowrap">{fmt(it._createdDate)}</div>
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${RESULTADO_COLOR[it.resultado] || ''}`}>
                                {RESULTADOS.find(r => r.id === it.resultado)?.label || it.resultado}
                              </span>
                            </>
                          ) : <span className="text-gray-400">Sin registro</span>}
                        </td>
                      )
                    })}
                    <td className="py-2">
                      {abierto && (
                        agregando === k.id ? (
                          <div className="flex items-center gap-1">
                            <select value={resultado} onChange={e => setResultado(e.target.value)}
                              className="px-2 py-1 border border-gray-300 rounded text-xs">
                              {RESULTADOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                            </select>
                            <button type="button" disabled={busy}
                              onClick={() => patch({ contacto: { canal: k.id, resultado } }).then(() => setAgregando(null))}
                              className="px-2 py-1 rounded bg-primary-600 text-white text-xs disabled:opacity-50">✓</button>
                            <button type="button" onClick={() => setAgregando(null)}
                              className="px-2 py-1 rounded border border-gray-300 text-xs">✕</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => { setAgregando(k.id); setResultado('CONTESTO') }}
                            title={`Registrar otro intento por ${k.label}`}
                            className="w-7 h-7 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-50 flex items-center justify-center">
                            <PlusIcon className="h-4 w-4" />
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Cada intento guarda usuario y hora. Almacenado en UTC, mostrado en {TZ}.
        </p>
      </section>

      {/* 6 · Acuerdo con apoderado */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Acuerdo con apoderado</h3>
        <textarea value={acuerdo} onChange={e => setAcuerdo(e.target.value)} disabled={!abierto} rows={3}
          placeholder="La apoderada se compromete a avisar inasistencias y a recuperar las clases perdidas"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fecha de compromiso</label>
            <input type="date" value={fechaCompromiso} onChange={e => setFechaCompromiso(e.target.value)} disabled={!abierto}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Responsable</label>
            <input type="text" value={responsable} onChange={e => setResponsable(e.target.value)} disabled={!abierto}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100" />
          </div>
        </div>
      </section>

      {/* 7 · Seguimiento: la bitácora del caso.
          Se arma con lo que YA queda escrito en cada sitio —el reporte del guía,
          cada cambio de estado con su comentario, cada intento de contacto— más
          las notas de gestión, que son lo único que no tenía dónde vivir. Por eso
          no hay aquí una copia del recorrido: se fusiona al leer. */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold text-gray-900">Seguimiento</h3>
          <span className="text-xs text-gray-400">{timeline.length} movimiento(s)</span>
        </div>

        {timeline.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no hay movimientos registrados.</p>
        ) : (
          <ol className="relative border-l border-gray-200 ml-1.5 space-y-4">
            {timeline.map((m: any, i: number) => {
              const meta = MOV_META[m.tipo] || MOV_META.NOTA
              return (
                <li key={`${m.tipo}-${i}`} className="relative pl-4">
                  {/* El punto va centrado sobre la línea del <ol>: el borde
                      izquierdo cae en left:0 del <li>, y el punto mide 10px. */}
                  <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${meta.punto}`} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${meta.chip}`}>{meta.label}</span>
                    <span className="font-medium text-gray-800">{tituloMovimiento(m)}</span>
                    <span className="text-gray-400">{fmt(m.fecha)}</span>
                    {m.autor && <span className="text-gray-500">· {m.autor}</span>}
                    {m.tipo === 'REPORTE' && m.meta?.tema && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {tipoCasoLabel(m.meta.tema)}
                      </span>
                    )}
                    {m.tipo === 'CONTACTO' && m.meta?.resultado && (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${RESULTADO_COLOR[m.meta.resultado] || ''}`}>
                        {RESULTADOS.find(r => r.id === m.meta.resultado)?.label || m.meta.resultado}
                      </span>
                    )}
                  </div>
                  {m.texto && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{m.texto}</p>}
                </li>
              )
            })}
          </ol>
        )}

        {abierto && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="block text-xs text-gray-500 mb-1">Agregar al seguimiento</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
                placeholder="La apoderada pidió que la llamemos el viernes por la tarde"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <button type="button" disabled={busy || !nota.trim()} onClick={agregarNota}
                className="px-4 py-2 h-fit rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                Agregar
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Los reportes, las asignaciones y los intentos de contacto entran solos. Aquí van las notas de la gestión.
            </p>
          </div>
        )}
      </section>

      {abierto && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Al salir de “En gestión” el caso se cierra y pasa al histórico. Requiere acuerdo registrado
            y un comentario que explique el movimiento.
          </p>
          <button type="button" disabled={busy} onClick={guardar}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy ? 'Guardando…' : nuevoEstado !== c.estado ? 'Aplicar cambio…' : 'Guardar'}
          </button>
        </div>
      )}

      {/* Confirmación del cambio de estado: el comentario es obligatorio porque
          es lo que la bitácora muestra junto al movimiento. Antes el cambio se
          aplicaba de una y la entrada del historial quedaba sin explicación. */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5">
            <h3 className="font-semibold text-gray-900">
              {cierraElCaso(nuevoEstado) ? 'Cerrar el caso' : 'Mover el caso'}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {estadoLabel(c.estado)} → <span className="font-medium text-gray-900">{ESTADO_LABEL[nuevoEstado]}</span>
              {cierraElCaso(nuevoEstado) && ' · pasa al histórico y queda en solo lectura'}
            </p>

            <label className="block text-sm font-medium text-gray-700 mt-4 mb-1">
              Comentario <span className="text-red-500">*</span>
            </label>
            <textarea value={motivoCambio} onChange={e => setMotivoCambio(e.target.value)} rows={3}
              placeholder={cierraElCaso(nuevoEstado)
                ? 'Por qué se cierra el caso y cómo quedó resuelto…'
                : 'Qué motiva el movimiento…'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">Queda en el seguimiento del caso, con tu nombre y la fecha.</p>

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" disabled={busy}
                onClick={() => { setConfirmando(false); setNuevoEstado(c.estado) }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" disabled={busy || !motivoCambio.trim()} onClick={confirmarCambio}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">
                {busy ? 'Guardando…' : cierraElCaso(nuevoEstado) ? 'Cerrar caso' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8 · Histórico */}
      {d.casosCerrados.length > 0 && (
        <section className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Histórico de casos</h3>
            <span className="text-xs text-gray-400">{d.casosCerrados.length} casos cerrados</span>
          </div>
          <ul className="space-y-3">
            {d.casosCerrados.map((h: any) => (
              <li key={h._id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button type="button" onClick={() => setCasoId(h._id)}
                    className="font-medium text-primary-600 hover:underline inline-flex items-center gap-1">
                    {h.codigo} <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-gray-500">{fmt(h.abiertoEn, false)} – {fmt(h.cerradoEn, false)}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">
                    {estadoLabel(h.estado)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                    {h.reportes} reporte(s) · {tipoCasoLabel(h.tema).toLowerCase()}
                  </span>
                </div>
                {h.acuerdo && <p className="text-sm text-gray-600 mt-2"><span className="text-gray-500">Acuerdo:</span> {h.acuerdo}</p>}
                {h.seguimientoFinanzas && <p className="text-sm text-gray-600"><span className="text-gray-500">Finanzas:</span> {h.seguimientoFinanzas}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
