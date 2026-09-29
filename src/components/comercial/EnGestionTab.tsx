'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  HORAS_EN_GESTION,
  entraEnGestion,
  msRestantesEnGestion,
  textoRestante,
} from '@/lib/contrato-en-gestion'

/**
 * Pestaña "En Gestión" de Gestión Contrato: los contratos recién creados que
 * todavía no se han FIRMADO, con el enlace para volver a editarlos. Al firmarse
 * pasan a la pestaña "Firmados sin aprobar".
 *
 * Queda montada aunque la pestaña no esté a la vista: el total se calcula al
 * entrar a la pantalla, porque ese número es el aviso — detrás de un clic nadie
 * se entera de que hay contratos esperando.
 */

interface Fila {
  _id: string
  nombre: string
  numeroId: string | null
  contrato: string | null
  asesor: string | null
  liderComercial: string | null
  creado: string
  aprobacion: string | null
  gestionListo: boolean
  firmado: boolean
  esPrueba: boolean
  extemporanea: boolean | null
  quitadoEn: string | null
  quitadoPor: string | null
}

/** Es un instante: se muestra en la hora local de quien mira. */
const fmtCreado = (v: string) => {
  try {
    return new Date(v).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return String(v).slice(0, 16) }
}

export default function EnGestionTab({ activo, onTotal }: { activo: boolean; onTotal?: (n: number) => void }) {
  const [rows, setRows] = useState<Fila[]>([])
  const [quitados, setQuitados] = useState(0)
  const [verQuitados, setVerQuitados] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmar, setConfirmar] = useState<Fila | null>(null)
  // El reloj avanza solo: el tiempo que le queda a cada contrato se actualiza y
  // la fila sale de la tabla cuando se cumple su plazo, sin recargar.
  const [ahora, setAhora] = useState(() => new Date())

  const cargar = useCallback(async (conQuitados: boolean) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/postgres/comercial/gestion-contrato/en-gestion${conQuitados ? '?quitados=1' : ''}`, { cache: 'no-store' })
        .then(r => r.json())
      if (res.error) throw new Error(res.error)
      setRows(res.rows || [])
      setQuitados(res.quitados ?? 0)
      setAhora(new Date())
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar los contratos en gestión')
    } finally { setLoading(false) }
  }, [])

  // Al entrar a la pantalla, al abrir la pestaña y al cambiar la casilla.
  useEffect(() => { cargar(verQuitados) }, [cargar, verQuitados, activo])

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const visibles = rows.filter(r => entraEnGestion(r, ahora, verQuitados))
  const enLista = visibles.filter(r => !r.quitadoEn).length

  useEffect(() => { onTotal?.(enLista) }, [enLista, onTotal])

  const cambiar = async (r: Fila, accion: 'quitar' | 'restaurar') => {
    setSaving(true)
    try {
      const res = await fetch('/api/postgres/comercial/gestion-contrato/en-gestion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r._id, accion }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(res.message)
      setConfirmar(null)
      await cargar(verQuitados)
    } catch (e: any) { toast.error(e?.message || 'Error') } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <span className="text-sm text-gray-500">
          {loading ? 'Cargando…' : `${enLista} contrato(s) sin firmar · creados en las últimas ${HORAS_EN_GESTION} horas`}
        </span>
        <div className="flex items-center gap-4">
          {(quitados > 0 || verQuitados) && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={verQuitados} onChange={e => setVerQuitados(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-purple-700 focus:ring-purple-500" />
              Ver los quitados ({quitados})
            </label>
          )}
          <button type="button" onClick={() => cargar(verQuitados)} disabled={loading}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50">
            Actualizar
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="text-left">
                <th className="text-xs font-semibold text-gray-600 uppercase px-4 py-3 border-b-2 border-gray-200">Titular</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Contrato</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Fecha</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200">Asesor</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-3 border-b-2 border-gray-200 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && visibles.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-sm text-gray-400 py-10">Cargando…</td></tr>
              ) : visibles.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-sm text-gray-400 py-10">
                  No hay contratos sin firmar creados en las últimas {HORAS_EN_GESTION} horas.
                </td></tr>
              ) : visibles.map(r => {
                const quitado = !!r.quitadoEn
                return (
                  <tr key={r._id} className={quitado ? 'bg-gray-50 text-gray-400' : 'hover:bg-purple-50/40'}>
                    <td className="px-4 py-3 border-b border-gray-100">
                      <div className="flex flex-col">
                        <b className={`text-[13.5px] ${quitado ? 'text-gray-500' : 'text-gray-900'}`}>{r.nombre || '(sin nombre)'}</b>
                        <span className="text-[11.5px] text-gray-500">
                          ID {r.numeroId || '—'}
                          {' · '}{r.firmado ? 'Firmado' : 'Sin firmar'}
                          {r.extemporanea ? ' · ⏰ Extemporánea' : ''}
                        </span>
                        {(r.esPrueba || quitado) && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {r.esPrueba && (
                              <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 bg-orange-100 text-orange-800">🧪 Contrato de prueba</span>
                            )}
                            {quitado && (
                              <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 bg-gray-200 text-gray-600"
                                title={`Quitado por ${r.quitadoPor || '—'} · ${fmtCreado(r.quitadoEn as string)}`}>
                                Quitado de la lista
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 border-b border-gray-100 text-sm font-medium text-gray-700 whitespace-nowrap">{r.contrato || '—'}</td>
                    <td className="px-3 py-3 border-b border-gray-100">
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-700 whitespace-nowrap">{fmtCreado(r.creado)}</span>
                        <span className="text-[11px] text-gray-500 whitespace-nowrap">
                          sale de la lista en {textoRestante(msRestantesEnGestion(r.creado, ahora))}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 border-b border-gray-100 text-sm text-gray-700">{(r.asesor || '').trim() || '—'}</td>
                    <td className="px-3 py-3 border-b border-gray-100">
                      <div className="flex items-center justify-end gap-2">
                        <a href={`/dashboard/comercial/contrato/${r._id}`} target="_blank" rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-purple-700 text-white text-xs font-medium hover:bg-purple-800 whitespace-nowrap">
                          ✎ Editar contrato
                        </a>
                        {quitado ? (
                          <button type="button" onClick={() => cambiar(r, 'restaurar')} disabled={saving}
                            className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-white whitespace-nowrap disabled:opacity-50">
                            ↩ Restaurar
                          </button>
                        ) : (
                          <button type="button" onClick={() => setConfirmar(r)}
                            className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 whitespace-nowrap">
                            Quitar de la lista
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quitar NO es dar de baja: el contrato no se toca. El modal lo dice con
          todas las letras porque en esta misma pantalla vive "Dar de baja", que
          sí borra. */}
      {confirmar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmar(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Quitar de la lista</h3>
            <p className="text-sm text-gray-600">
              El contrato <strong>{confirmar.contrato}</strong> de <strong>{confirmar.nombre}</strong> dejará
              de aparecer en <strong>En Gestión</strong>.
            </p>
            <p className="mt-3 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">
              El contrato <strong>no se borra ni se modifica</strong>. Para volver a verlo aquí, marca
              «Ver los quitados» y pulsa Restaurar.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmar(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={() => cambiar(confirmar, 'quitar')} disabled={saving}
                className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {saving ? 'Quitando…' : 'Quitar de la lista'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
