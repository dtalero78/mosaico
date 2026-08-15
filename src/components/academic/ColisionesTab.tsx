'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircleIcon, ExclamationTriangleIcon, LinkIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline'

/**
 * Pestaña "Colisiones" de Campañas.
 *
 * Un guía no puede dictar dos cursos a la misma hora… salvo que sea a propósito:
 * en sábado se juntan salones (típicamente DANSHI con SENPAI) y el guía atiende
 * a los alumnos de los dos en una sola sesión. Esta pestaña lista los cruces de
 * la campaña y deja resolverlos de las dos formas: **unir los salones** (cuando
 * coinciden en horario) o **corregir** el horario/guía desde Gestión.
 *
 * Verde = sin cruces. Rojo = hay cruces por resolver.
 */

interface CursoRef {
  _id: string
  campaign: string
  tipoCurso: string
  salon: string | null
  horarioCurso: string
  guiaNombre?: string | null
  grupoHorarioId?: string | null
}

interface Colision {
  curso: CursoRef
  contra: CursoRef & { vigenciaIndeterminada?: boolean }
  descripcion: string
  unible: boolean
}

interface GrupoDeclarado {
  grupoHorarioId: string
  cursos: CursoRef[]
}

const etiqueta = (c: CursoRef) =>
  [c.tipoCurso, c.salon ? `Salón ${c.salon}` : null, c.horarioCurso].filter(Boolean).join(' · ')

export default function ColisionesTab({
  campaign,
  /** Reporta el nº de colisiones para que la pestaña se pinte verde/rojo. */
  onCount,
}: {
  campaign: string
  onCount?: (n: number | null) => void
}) {
  const [loading, setLoading] = useState(false)
  const [colisiones, setColisiones] = useState<Colision[]>([])
  const [grupos, setGrupos] = useState<GrupoDeclarado[]>([])
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<Colision | null>(null)

  const cargar = useCallback(async () => {
    if (!campaign) { setColisiones([]); setGrupos([]); onCount?.(null); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/postgres/campaigns/grupo-horario?campaign=${encodeURIComponent(campaign)}`, { cache: 'no-store' })
      const j = await r.json()
      if (j?.success) {
        setColisiones(j.colisiones || []); setGrupos(j.grupos || [])
        onCount?.(Number(j.total) || 0)
      } else setMsg({ type: 'err', text: j?.error || 'No se pudieron cargar las colisiones.' })
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || 'Error de red.' })
    } finally { setLoading(false) }
    // `onCount` se omite a propósito: es un setState del padre, estable en la
    // práctica, e incluirlo re-dispararía la carga en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign])

  useEffect(() => { cargar() }, [cargar])

  const unir = async (c: Colision) => {
    setBusy(c.curso._id); setMsg(null)
    try {
      const r = await fetch('/api/postgres/campaigns/grupo-horario', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursoIds: [c.curso._id, c.contra._id] }),
      })
      const j = await r.json()
      if (j?.success) {
        setMsg({
          type: 'ok',
          text: `Salones unidos: ${etiqueta(c.curso)} + ${etiqueta(c.contra)}. ` +
                `Se regeneraron ${j.eventosRegenerados} evento(s) y se conservaron ${j.bookingsRegenerados} agendamiento(s).`,
        })
        setConfirmar(null)
        await cargar()
      } else setMsg({ type: 'err', text: j?.error || 'No se pudieron unir.' })
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || 'Error de red.' })
    } finally { setBusy(null) }
  }

  const deshacer = async (grupoHorarioId: string) => {
    setBusy(grupoHorarioId); setMsg(null)
    try {
      const r = await fetch(`/api/postgres/campaigns/grupo-horario?grupo=${encodeURIComponent(grupoHorarioId)}`, { method: 'DELETE' })
      const j = await r.json()
      if (j?.success) {
        setMsg({ type: 'ok', text: `Grupo deshecho. Se conservaron ${j.bookingsRegenerados} agendamiento(s).` })
        await cargar()
      } else setMsg({ type: 'err', text: j?.error || 'No se pudo deshacer.' })
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || 'Error de red.' })
    } finally { setBusy(null) }
  }

  if (!campaign) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm">
        Selecciona una campaña en la pestaña Gestión para revisar sus colisiones.
      </div>
    )
  }

  const hay = colisiones.length > 0

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`p-3 rounded-md text-sm ${msg.type === 'ok'
          ? 'bg-green-50 border border-green-200 text-green-700'
          : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Semáforo: verde si no hay cruces, rojo si los hay. */}
      <div className={`rounded-xl border p-5 flex items-start gap-3 ${hay
        ? 'bg-red-50 border-red-200'
        : 'bg-green-50 border-green-200'}`}>
        {hay
          ? <ExclamationTriangleIcon className="h-6 w-6 text-red-600 flex-shrink-0" />
          : <CheckCircleIcon className="h-6 w-6 text-green-600 flex-shrink-0" />}
        <div className="flex-1">
          <h3 className={`font-semibold ${hay ? 'text-red-800' : 'text-green-800'}`}>
            {loading ? 'Revisando…'
              : hay ? `${colisiones.length} colisión(es) de guía en ${campaign}`
                    : `Sin colisiones en ${campaign}`}
          </h3>
          <p className={`text-sm mt-0.5 ${hay ? 'text-red-700' : 'text-green-700'}`}>
            {hay
              ? 'Un guía quedó con dos cursos a la misma hora. Únelos si es un salón compartido, o corrige el horario o el guía desde Gestión.'
              : 'Ningún guía tiene dos cursos a la misma hora.'}
          </p>
        </div>
        <button type="button" onClick={cargar} disabled={loading}
          className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <ArrowPathIcon className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Revisar
        </button>
      </div>

      {/* Colisiones por resolver */}
      {hay && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Guía</th>
                  <th className="px-4 py-2 text-left font-medium">Curso de {campaign}</th>
                  <th className="px-4 py-2 text-left font-medium">Choca con</th>
                  <th className="px-4 py-2 text-left font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {colisiones.map((c, i) => (
                  <tr key={`${c.curso._id}-${c.contra._id}-${i}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-900">{c.curso.guiaNombre || '—'}</td>
                    <td className="px-4 py-2 text-gray-700">{etiqueta(c.curso)}</td>
                    <td className="px-4 py-2 text-gray-700">{c.descripcion}</td>
                    <td className="px-4 py-2">
                      {c.unible ? (
                        <button type="button" onClick={() => setConfirmar(c)} disabled={!!busy}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                          <LinkIcon className="h-3.5 w-3.5 mr-1" /> Unir salones
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">
                          Corregir en Gestión
                          <span className="block text-[11px] text-gray-400">
                            {c.contra.campaign !== c.curso.campaign
                              ? 'es de otra campaña'
                              : 'los horarios no son idénticos'}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grupos ya declarados */}
      {grupos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-primary-600" /> Salones unidos ({grupos.length})
          </h3>
          <p className="text-sm text-gray-600 mb-3">
            El guía dicta una sola sesión para estos cursos. La asistencia se marca por curso,
            y en Control de Horas cuenta como una hora, no como varias.
          </p>
          <ul className="space-y-2">
            {grupos.map(g => (
              <li key={g.grupoHorarioId} className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <div className="text-gray-900">{g.cursos.map(etiqueta).join('  +  ')}</div>
                  <div className="text-xs text-gray-500">{g.cursos[0]?.guiaNombre || '—'}</div>
                </div>
                <button type="button" onClick={() => deshacer(g.grupoHorarioId)} disabled={busy === g.grupoHorarioId}
                  className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
                  {busy === g.grupoHorarioId ? 'Deshaciendo…' : 'Deshacer'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confirmación de unión */}
      {confirmar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">Unir salones</h3>
            <p className="text-sm text-gray-600 mt-2">
              {confirmar.curso.guiaNombre || 'El guía'} dictará una sola sesión para los dos cursos:
            </p>
            <ul className="mt-3 space-y-1 text-sm text-gray-800">
              <li className="border border-gray-200 rounded-md px-3 py-2">{etiqueta(confirmar.curso)}</li>
              <li className="border border-gray-200 rounded-md px-3 py-2">{etiqueta(confirmar.contra)}</li>
            </ul>
            <p className="text-xs text-gray-500 mt-3">
              Cada curso conserva sus alumnos, su cupo y su propia lista de asistencia.
              Se regeneran los eventos de ambos preservando la asistencia ya marcada.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(null)} disabled={!!busy}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button" onClick={() => unir(confirmar)} disabled={!!busy}
                className="px-4 py-2 text-sm rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? 'Uniendo…' : 'Unir salones'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
