'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowTopRightOnSquareIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  type TipoAutorizacion, type ReporteRef,
  MAX_AUTORIZACIONES_POR_LOTE, MENSAJE_PIDE_AUTORIZACION,
} from '@/lib/autorizacion-gestion'

/**
 * Columna "Autoriza" de Procesos sin gestión — las piezas que comparten las tres
 * pestañas (Sesiones académicas · Eventos administrativos · Reporte Académico):
 * la casilla de cada fila, la del encabezado (todas las visibles), el modal de
 * confirmación del lote, el envío al servidor y el botón «Ir» del guía.
 *
 * Viven juntas para que las tres pestañas no puedan divergir: con una copia en
 * cada una, la primera corrección las desalinea.
 *
 * Regla que pintan (la real está en el servidor):
 *   - fila EN PLAZO   → no necesita autorización; se muestra "En plazo".
 *   - fila VENCIDA    → casilla (si puede autorizar) o el estado en texto.
 *   - guía + vencida sin autorizar → el «Ir» sale apagado.
 */

export interface FilaAutorizable {
  vencido: boolean
  autorizado: boolean
  autorizadoPor?: string | null
  autorizadoEn?: string | null
}

export const irBloqueadoParaGuia = (esGuia: boolean, f: FilaAutorizable) =>
  esGuia && f.vencido && !f.autorizado

const fechaCorta = (iso?: string | null) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) }
  catch { return '' }
}

const tituloAutorizada = (f: FilaAutorizable) =>
  f.autorizado
    ? `Autorizada${f.autorizadoPor ? ` por ${f.autorizadoPor}` : ''}${f.autorizadoEn ? ` · ${fechaCorta(f.autorizadoEn)}` : ''}. El guía puede gestionarla aunque el plazo venció.`
    : 'Plazo vencido y sin autorizar: el guía no puede gestionarla.'

/** Casilla (o estado) de una fila. */
export function AutorizaCelda({ fila, puedeAutorizar, ocupado, onToggle }: {
  fila: FilaAutorizable
  puedeAutorizar: boolean
  ocupado?: boolean
  onToggle: () => void
}) {
  if (!fila.vencido) {
    return (
      <span className="inline-block text-[11px] text-gray-400 whitespace-nowrap"
        title="Aún dentro del plazo del guía: no necesita autorización.">En plazo</span>
    )
  }
  if (puedeAutorizar) {
    return (
      <label className="inline-flex items-center gap-1.5 cursor-pointer" title={tituloAutorizada(fila)}>
        <input type="checkbox" checked={fila.autorizado} disabled={ocupado} onChange={onToggle}
          className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50" />
        {fila.autorizado && <ShieldCheckIcon className="h-4 w-4 text-emerald-600" aria-hidden />}
      </label>
    )
  }
  return fila.autorizado ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap"
      title={tituloAutorizada(fila)}>
      <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden /> Autorizado
    </span>
  ) : (
    <span className="inline-block text-[11px] text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 whitespace-nowrap"
      title={tituloAutorizada(fila)}>Sin autorizar</span>
  )
}

/**
 * Casilla del encabezado: autoriza o desautoriza TODAS las filas visibles (las que
 * dejan los filtros) que estén vencidas. Marcada si todas lo están; a medias si
 * sólo algunas.
 */
export function AutorizaEncabezado({ filas, puedeAutorizar, ocupado, onToggleTodas, className = '' }: {
  filas: FilaAutorizable[]
  puedeAutorizar: boolean
  ocupado?: boolean
  onToggleTodas: (autorizar: boolean) => void
  className?: string
}) {
  const vencidas = filas.filter(f => f.vencido)
  const autorizadas = vencidas.filter(f => f.autorizado).length
  const todas = vencidas.length > 0 && autorizadas === vencidas.length
  const algunas = autorizadas > 0 && !todas
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = algunas }, [algunas])
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {puedeAutorizar && vencidas.length > 0 && (
        <input ref={ref} type="checkbox" checked={todas} disabled={ocupado}
          onChange={() => onToggleTodas(!todas)}
          title={todas
            ? `Quitar la autorización a las ${vencidas.length} filas visibles`
            : `Autorizar las ${vencidas.length - autorizadas} filas visibles que faltan`}
          className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50" />
      )}
      <span title="Coordinación autoriza al guía a gestionar lo que ya venció.">Autoriza</span>
    </span>
  )
}

/** Confirmación del lote: dice cuántas y qué va a pasar antes de escribir. */
export function ConfirmarAutorizacionMasiva({ autorizar, total, queSon, ocupado, onConfirm, onCancel }: {
  autorizar: boolean
  total: number
  /** "sesiones", "eventos administrativos", "informes" */
  queSon: string
  ocupado?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3">
          <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 ${autorizar ? 'bg-emerald-100' : 'bg-amber-100'}`}>
            <ShieldCheckIcon className={`h-6 w-6 ${autorizar ? 'text-emerald-600' : 'text-amber-600'}`} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {autorizar ? `Autorizar ${total} ${queSon}` : `Quitar la autorización a ${total} ${queSon}`}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {autorizar
                ? <>Son las filas <strong>visibles con los filtros puestos</strong> y ya vencidas. Cada guía podrá entrar con «Ir» a las suyas, gestionarlas y cerrarlas; el cierre queda a su nombre, marcado "con autorización".</>
                : <>Los guías dejarán de poder gestionar estas filas; volverán a ver «Ir» apagado hasta que alguien las autorice de nuevo.</>}
            </p>
            {total > MAX_AUTORIZACIONES_POR_LOTE && (
              <p className="text-xs text-gray-500 mt-2">Se enviarán en tandas de {MAX_AUTORIZACIONES_POR_LOTE}.</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={ocupado}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={ocupado}
            className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${autorizar ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
            {ocupado ? 'Guardando…' : autorizar ? 'Autorizar' : 'Quitar autorización'}
          </button>
        </div>
      </div>
    </div>
  )
}

export interface ResultadoAutorizar {
  aplicados: number
  sinCambio: number
  omitidos: Array<{ refId: string; motivo: string }>
}

/**
 * Envía el lote al servidor en tandas de `MAX_AUTORIZACIONES_POR_LOTE` y suma
 * los resultados. Lanza si alguna tanda falla (lo ya aplicado queda aplicado).
 */
export async function enviarAutorizacion(input: {
  tipo: TipoAutorizacion
  autorizar: boolean
  refIds?: string[]
  items?: ReporteRef[]
}): Promise<ResultadoAutorizar> {
  const total: ResultadoAutorizar = { aplicados: 0, sinCambio: 0, omitidos: [] }
  const lista: any[] = input.tipo === 'REPORTE' ? (input.items || []) : (input.refIds || [])
  for (let i = 0; i < lista.length; i += MAX_AUTORIZACIONES_POR_LOTE) {
    const tanda = lista.slice(i, i + MAX_AUTORIZACIONES_POR_LOTE)
    const body = input.tipo === 'REPORTE'
      ? { tipo: input.tipo, autorizar: input.autorizar, items: tanda }
      : { tipo: input.tipo, autorizar: input.autorizar, refIds: tanda }
    const r = await fetch('/api/postgres/reports/academico/procesos-sin-gestion/autorizar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
    total.aplicados += Number(j.aplicados || 0)
    total.sinCambio += Number(j.sinCambio || 0)
    total.omitidos.push(...(Array.isArray(j.omitidos) ? j.omitidos : []))
  }
  return total
}

/** Resume el resultado en un toast (una sola línea, con lo que quedó fuera). */
export function avisarResultado(r: ResultadoAutorizar, autorizar: boolean) {
  const verbo = autorizar ? 'Autorizadas' : 'Sin autorización'
  const partes = [`${verbo}: ${r.aplicados}`]
  if (r.sinCambio) partes.push(`ya estaban: ${r.sinCambio}`)
  if (r.omitidos.length) partes.push(`omitidas: ${r.omitidos.length} (${r.omitidos[0].motivo})`)
  const msg = partes.join(' · ')
  if (r.aplicados === 0 && r.omitidos.length) toast(msg, { icon: '⚠️' })
  else toast.success(msg)
}

/** Botón «Ir» de una fila; para el guía se apaga cuando el proceso venció sin autorización. */
export function IrEnlace({ href, bloqueado, title, className = 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50' }: {
  href: string
  bloqueado: boolean
  title: string
  className?: string
}) {
  if (bloqueado) {
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-300 cursor-not-allowed"
        title={MENSAJE_PIDE_AUTORIZACION} aria-disabled>
        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
      </span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${className}`}>
      <ArrowTopRightOnSquareIcon className="h-5 w-5" />
    </a>
  )
}

/** Estado compartido del lote en curso (para que las pestañas no repitan los mismos useState). */
export function useLoteAutorizacion() {
  const [ocupado, setOcupado] = useState(false)
  const [pendiente, setPendiente] = useState<{ autorizar: boolean; total: number; queSon: string; ejecutar: () => Promise<void> } | null>(null)
  const confirmar = async () => {
    if (!pendiente) return
    setOcupado(true)
    try { await pendiente.ejecutar(); setPendiente(null) }
    catch (e: any) { toast.error(e?.message || 'No se pudo guardar') }
    finally { setOcupado(false) }
  }
  return { ocupado, setOcupado, pendiente, setPendiente, confirmar }
}
