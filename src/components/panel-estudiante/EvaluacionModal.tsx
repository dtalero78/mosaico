'use client'

import { useEffect, useState } from 'react'
import { useEvaluarMutation } from '@/hooks/use-evaluations'
import { checkProfanity, PROFANITY_MESSAGE } from '@/lib/profanity-filter'

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
  /** Booking a evaluar (UN solo elemento — la cadena se eliminó en V2). */
  item: PendingItem
  /** "Evaluar más tarde" o cerrar con X. No envía nada. */
  onClose: () => void
  /** Evaluación enviada con éxito → callback (típicamente refetch o navegar). */
  onSubmitted?: () => void
  /** Texto del botón "más tarde". Si está en modo soft-prompt (al agendar)
   * el llamador puede pasar "Evaluar más tarde y agendar" o similar. */
  laterButtonLabel?: string
}

const DIMS = [
  {
    key: 'puntualidad',
    label: 'Puntualidad y organización',
    quote: 'La clase comenzó y terminó a tiempo.',
  },
  {
    key: 'claridad',
    label: 'Claridad de la explicación',
    quote: 'Las explicaciones e instrucciones fueron claras.',
  },
  {
    key: 'actividades',
    label: 'Participación y variedad de actividades',
    quote: 'La clase tuvo actividades variadas y me permitió participar.',
  },
  {
    key: 'ambiente',
    label: 'Ambiente de aprendizaje',
    quote: 'Me sentí cómodo/a participando durante la clase.',
  },
] as const

const SCALE: Record<number, string> = {
  1: 'Muy bajo', 2: 'Bajo', 3: 'Medio', 4: 'Bueno', 5: 'Excelente',
}

const COMMENT_MAX = 250

/**
 * Modal de evaluación V2:
 *   - 4 dimensiones (no 6) con citas descriptivas.
 *   - Comentario opcional, máximo 250 caracteres.
 *   - Filtro client-side de groserías (segunda barrera = server).
 *   - Botón "Evaluar más tarde" reemplaza el checkbox de confirmación —
 *     el usuario puede cerrar el modal sin penalización.
 */
export default function EvaluacionModal({
  item, onClose, onSubmitted, laterButtonLabel = 'Evaluar más tarde',
}: Props) {
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [comentario, setComentario] = useState('')
  const [profanityError, setProfanityError] = useState<string | null>(null)
  const mutation = useEvaluarMutation()

  // Reset si cambia el item (lista seleccionable → mismo modal reusado).
  useEffect(() => {
    setRatings({})
    setComentario('')
    setProfanityError(null)
  }, [item.bookingId])

  // Validación de groserías mientras escribe — muestra mensaje rojo inline.
  useEffect(() => {
    if (!comentario.trim()) { setProfanityError(null); return }
    const res = checkProfanity(comentario)
    setProfanityError(res.blocked ? res.message ?? PROFANITY_MESSAGE : null)
  }, [comentario])

  const allRated = DIMS.every(d => (ratings[d.key] ?? 0) >= 1)
  const canSubmit = allRated && !profanityError && !mutation.isLoading

  const handleSubmit = async () => {
    if (!canSubmit) return
    try {
      await mutation.mutateAsync({
        bookingId:   item.bookingId,
        puntualidad: ratings.puntualidad,
        claridad:    ratings.claridad,
        actividades: ratings.actividades,
        ambiente:    ratings.ambiente,
        comentario:  comentario.trim() || null,
      })
      onSubmitted?.()
      onClose()
    } catch {/* toast lo maneja el hook */}
  }

  const fechaFmt = item.fechaEvento ? new Date(item.fechaEvento).toLocaleString('es-ES') : '—'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-gray-900/70" onClick={() => !mutation.isLoading && onClose()} />
        <div className="relative bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-900">⭐ Evalúa tu sesión</h3>
              <p className="text-xs text-gray-400">Tu feedback nos ayuda a mejorar las clases</p>
            </div>
            <button type="button" onClick={() => !mutation.isLoading && onClose()}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none" title="Cerrar">&times;</button>
          </div>

          {/* Datos del evento */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1 mb-4 border border-gray-200">
            <div><strong>Advisor:</strong> {item.advisorNombre || '—'}</div>
            <div><strong>Evento:</strong> {item.tipo}{item.nombreEvento ? ` · ${item.nombreEvento}` : ` · ${item.step}`} · <span className="text-gray-500">{item.nivel}</span></div>
            <div><strong>Fecha:</strong> {fechaFmt}</div>
          </div>

          {/* Ratings — 4 dims con cita en itálicas */}
          <div className="space-y-4 mb-4">
            {DIMS.map(d => (
              <div key={d.key} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="mb-1.5">
                  <div className="text-sm font-semibold text-gray-800">{d.label}</div>
                  <div className="text-xs text-gray-500 italic">&quot;{d.quote}&quot;</div>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
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
                  <span className="text-[11px] text-gray-500 ml-2 w-20">{ratings[d.key] ? SCALE[ratings[d.key]] : ''}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Comentario — máx 250 + filtro de groserías */}
          <div className="mb-4">
            <label htmlFor="eval-coment" className="block text-sm font-medium text-gray-700 mb-1">
              Opinión o aportes <span className="text-gray-400">(opcional, máx {COMMENT_MAX})</span>
            </label>
            <textarea
              id="eval-coment"
              rows={3}
              value={comentario}
              onChange={e => setComentario(e.target.value.slice(0, COMMENT_MAX))}
              disabled={mutation.isLoading}
              placeholder="¿Algo que quieras destacar o sugerir?"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                profanityError
                  ? 'border-red-400 focus:ring-red-500 bg-red-50'
                  : 'border-gray-300 focus:ring-indigo-500'
              }`}
            />
            <div className="flex justify-between items-center mt-1">
              <p className={`text-xs ${profanityError ? 'text-red-600 font-medium' : 'text-transparent'}`}>
                {profanityError || '·'}
              </p>
              <p className="text-[10px] text-gray-400">{comentario.length}/{COMMENT_MAX}</p>
            </div>
          </div>

          {/* Acciones — "Evaluar más tarde" (cerrar sin enviar) | "Enviar" */}
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => !mutation.isLoading && onClose()}
              disabled={mutation.isLoading}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {laterButtonLabel}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              {mutation.isLoading ? 'Enviando…' : 'Enviar evaluación'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
