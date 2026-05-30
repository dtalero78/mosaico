'use client'

import { useState } from 'react'
import { useEvaluarMutation } from '@/hooks/use-evaluations'

interface PendingItem {
  bookingId: string
  advisorNombre?: string | null
  tipo: string
  nivel: string
  step: string
  nombreEvento?: string | null
  fechaEvento?: string | null
}

interface Props {
  items: PendingItem[]                                     // cadena de evaluaciones pendientes
  onClose: () => void                                      // cerrar sin terminar
  onAllDone?: () => void                                   // cuando termina la cadena
}

const DIMS = [
  { key: 'puntualidad',         label: 'Puntualidad y organización' },
  { key: 'claridad',             label: 'Claridad de la explicación' },
  { key: 'actividades',          label: 'Actividades y herramientas utilizadas' },
  { key: 'ambiente',             label: 'Ambiente de aprendizaje' },
  { key: 'motivacion',           label: 'Motivación y participación generada' },
  { key: 'satisfaccionGeneral',  label: 'Satisfacción general' },
] as const

const SCALE: Record<number, string> = {
  1: 'Muy bajo', 2: 'Bajo', 3: 'Medio', 4: 'Bueno', 5: 'Excelente',
}

/**
 * Modal de evaluación en MODO CADENA: si hay varios pendientes,
 * va evaluando uno tras otro hasta vaciar la lista. Botón "Cerrar"
 * cierra sin penalizar (las pendientes siguen ahí en el panel).
 */
export default function EvaluacionModal({ items, onClose, onAllDone }: Props) {
  const [idx, setIdx] = useState(0)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [comentario, setComentario] = useState('')
  const [confirm, setConfirm] = useState(false)
  const mutation = useEvaluarMutation()

  const current = items[idx]
  if (!current) return null

  const allRated = DIMS.every(d => (ratings[d.key] ?? 0) >= 1)
  const canSubmit = allRated && confirm && !mutation.isLoading

  const reset = () => { setRatings({}); setComentario(''); setConfirm(false) }

  const handleSubmit = async () => {
    if (!canSubmit) return
    try {
      await mutation.mutateAsync({
        bookingId: current.bookingId,
        puntualidad:         ratings.puntualidad,
        claridad:            ratings.claridad,
        actividades:         ratings.actividades,
        ambiente:            ratings.ambiente,
        motivacion:          ratings.motivacion,
        satisfaccionGeneral: ratings.satisfaccionGeneral,
        comentario:          comentario.trim() || null,
      })
      // Avanzar al siguiente en la cadena
      if (idx + 1 < items.length) { setIdx(idx + 1); reset() }
      else { onAllDone?.(); onClose() }
    } catch {/* toast lo maneja el hook */}
  }

  const fechaFmt = current.fechaEvento ? new Date(current.fechaEvento).toLocaleString('es-ES') : '—'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-gray-900/70" onClick={() => !mutation.isLoading && onClose()} />
        <div className="relative bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-900">⭐ Evalúa tu sesión</h3>
              <p className="text-xs text-gray-400">
                {items.length > 1 ? `Evaluación ${idx + 1} de ${items.length}` : 'Tu feedback nos ayuda a mejorar las clases'}
              </p>
            </div>
            <button type="button" onClick={() => !mutation.isLoading && onClose()}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none" title="Cerrar">&times;</button>
          </div>

          {/* Datos del evento */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1 mb-4 border border-gray-200">
            <div><strong>Advisor:</strong> {current.advisorNombre || '—'}</div>
            <div><strong>Evento:</strong> {current.tipo}{current.nombreEvento ? ` · ${current.nombreEvento}` : ` · ${current.step}`} · <span className="text-gray-500">{current.nivel}</span></div>
            <div><strong>Fecha:</strong> {fechaFmt}</div>
          </div>

          {/* Ratings */}
          <div className="space-y-3 mb-4">
            {DIMS.map(d => (
              <div key={d.key} className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-sm font-medium text-gray-700 flex-1 min-w-[200px]">{d.label}</label>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRatings(r => ({ ...r, [d.key]: n }))}
                      disabled={mutation.isLoading}
                      className={`text-2xl transition-transform hover:scale-125 disabled:opacity-50 ${
                        (ratings[d.key] ?? 0) >= n ? 'text-amber-400' : 'text-gray-300 hover:text-amber-200'
                      }`}
                      title={SCALE[n]}
                      aria-label={`${d.label}: ${n} estrella${n>1?'s':''} (${SCALE[n]})`}
                    >★</button>
                  ))}
                  <span className="text-[10px] text-gray-400 ml-2 w-16">{ratings[d.key] ? SCALE[ratings[d.key]] : ''}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Comentario */}
          <div className="mb-4">
            <label htmlFor="eval-coment" className="block text-sm font-medium text-gray-700 mb-1">
              Opinión o aportes <span className="text-gray-400">(opcional, máx 1000)</span>
            </label>
            <textarea
              id="eval-coment"
              rows={3}
              value={comentario}
              onChange={e => setComentario(e.target.value.slice(0, 1000))}
              disabled={mutation.isLoading}
              placeholder="¿Algo que quieras destacar o sugerir?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[10px] text-gray-400 text-right">{comentario.length}/1000</p>
          </div>

          {/* Confirm + Submit */}
          <label className="flex items-center gap-2 text-sm text-gray-700 mb-4">
            <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} disabled={mutation.isLoading}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            Confirmo que mi evaluación es genuina y no será modificable.
          </label>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => !mutation.isLoading && onClose()}
              disabled={mutation.isLoading}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Cerrar
            </button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit}
              className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold">
              {mutation.isLoading ? 'Enviando…' : (idx + 1 < items.length ? 'Enviar y siguiente →' : 'Enviar evaluación')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
