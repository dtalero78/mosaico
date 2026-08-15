'use client'

import { useMemo, useState } from 'react'
import { LinkIcon } from '@heroicons/react/24/outline'
import { MAX_CURSOS_GRUPO } from '@/lib/grupo-horario'

/**
 * "¿Va a adicionar salón?" — aparece al asignarle guía a un curso de SÁBADO.
 *
 * En sábado es habitual juntar salones (típicamente DANSHI con SENPAI): el guía
 * dicta una sola sesión y atiende a los alumnos de los dos cursos. Cada curso
 * conserva sus alumnos, su cupo y su propia lista de asistencia.
 *
 * Es **iterativo**: se adiciona un salón, y al terminar se vuelve a preguntar si
 * va otro, hasta el máximo de 3 (1 principal + 2 adicionales).
 */

export interface CursoLite {
  _id: string
  campaign: string
  tipoCurso: string
  salon: string | null
  horarioCurso: string
  guia?: string | null
  grupoHorarioId?: string | null
}

const etiqueta = (c: CursoLite) =>
  [c.tipoCurso, c.salon ? `Salón ${c.salon}` : null].filter(Boolean).join(' · ')

export default function AdicionarSalonModal({
  padre, cursos, guiaNombre, onClose, onUnido,
}: {
  /** El curso al que se le acaba de asignar guía. */
  padre: CursoLite
  /** Todos los cursos de la campaña (para elegir el adicional). */
  cursos: CursoLite[]
  guiaNombre?: string | null
  onClose: () => void
  /** Se llama tras cada unión para que el padre recargue la lista. */
  onUnido?: () => void
}) {
  const [enGrupo, setEnGrupo] = useState<CursoLite[]>([padre])
  const [tipoSel, setTipoSel] = useState('')
  const [cursoSel, setCursoSel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const yaEn = useMemo(() => new Set(enGrupo.map(c => c._id)), [enGrupo])

  /**
   * Candidatos: misma campaña, MISMO horario (el del curso principal), sin grupo
   * previo y que no estén ya en éste. El horario no se elige — se hereda del
   * principal, que es justamente lo que hace que sea el mismo bloque de clase.
   */
  const candidatos = useMemo(() => cursos.filter(c =>
    c._id !== padre._id
    && !yaEn.has(c._id)
    && c.campaign === padre.campaign
    && String(c.horarioCurso || '').trim() === String(padre.horarioCurso || '').trim()
    && !c.grupoHorarioId
  ), [cursos, padre, yaEn])

  const tipos = useMemo(
    () => Array.from(new Set(candidatos.map(c => c.tipoCurso))).sort(),
    [candidatos]
  )
  const salones = useMemo(
    () => candidatos.filter(c => c.tipoCurso === tipoSel),
    [candidatos, tipoSel]
  )

  const lleno = enGrupo.length >= MAX_CURSOS_GRUPO
  const sinCandidatos = candidatos.length === 0

  const adicionar = async () => {
    const elegido = candidatos.find(c => c._id === cursoSel)
    if (!elegido) { setErr('Elige el curso y el salón que se van a adicionar.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/postgres/campaigns/grupo-horario', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Se reenvía el grupo COMPLETO: el endpoint rechaza unir algo que ya
        // pertenece a un grupo, así que al adicionar el 3.º hay que rehacerlo.
        body: JSON.stringify({ cursoIds: [...enGrupo.map(c => c._id), elegido._id] }),
      })
      const d = await res.json()
      if (!res.ok || !d?.success) throw new Error(d?.error || 'No se pudo adicionar el salón.')
      setEnGrupo(prev => [...prev, elegido])
      setTipoSel(''); setCursoSel('')
      onUnido?.()
    } catch (e: any) {
      setErr(e?.message || 'Error de red.')
    } finally { setBusy(false) }
  }

  const adicionados = enGrupo.length - 1

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <LinkIcon className="h-5 w-5 text-primary-600" />
          {adicionados === 0 ? '¿Va a adicionar salón?' : '¿Va a adicionar otro salón?'}
        </h3>

        <p className="text-sm text-gray-600 mt-2">
          {guiaNombre ? <strong>{guiaNombre}</strong> : 'El guía'} quedó asignado a{' '}
          <strong>{etiqueta(padre)}</strong> · <strong>{padre.horarioCurso}</strong>.
          {adicionados === 0
            ? ' ¿Va a dictar en ese mismo horario otro salón?'
            : ' Puedes sumar uno más al mismo bloque.'}
        </p>

        {/* Salones ya en el grupo */}
        <ul className="mt-3 space-y-1 text-sm">
          {enGrupo.map((c, i) => (
            <li key={c._id} className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2">
              <span className="text-xs text-gray-400 w-16 flex-shrink-0">
                {i === 0 ? 'Principal' : `Salón ${i + 1}`}
              </span>
              <span className="text-gray-800">{etiqueta(c)}</span>
            </li>
          ))}
        </ul>

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        {lleno ? (
          <p className="mt-4 text-sm text-gray-600">
            Ya son {MAX_CURSOS_GRUPO} salones, que es el máximo del grupo.
          </p>
        ) : sinCandidatos ? (
          <p className="mt-4 text-sm text-gray-600">
            No hay otro curso de <strong>{padre.campaign}</strong> en {padre.horarioCurso} disponible
            para unir. {adicionados > 0 && 'Los que había ya están en el grupo.'}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Curso</label>
              <select
                value={tipoSel}
                onChange={e => { setTipoSel(e.target.value); setCursoSel('') }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Selecciona…</option>
                {tipos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Salón</label>
              <select
                value={cursoSel}
                onChange={e => setCursoSel(e.target.value)}
                disabled={!tipoSel}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100"
              >
                <option value="">Selecciona…</option>
                {salones.map(c => <option key={c._id} value={c._id}>{c.salon || '—'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Horario</label>
              {/* No se elige: es el del curso principal, y coincidir es la condición. */}
              <input
                type="text" value={padre.horarioCurso} readOnly
                title="Es el horario del curso principal — los salones del grupo deben coincidir"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600"
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            {adicionados === 0 ? 'No, así está bien' : 'Listo'}
          </button>
          {!lleno && !sinCandidatos && (
            <button type="button" onClick={adicionar} disabled={busy || !cursoSel}
              className="px-4 py-2 text-sm rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
              {busy ? 'Adicionando…' : 'Sí, adicionar salón'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
