'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  MegaphoneIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface TickerConfig {
  message: string
  color: string
  updatedBy: string | null
  updatedAt: string | null
}

const DEFAULT_TICKER: TickerConfig = {
  message: '📢 Usuarios Ecuador 🇪🇨 y Chile 🇨🇱: viernes 3 y sábado 4 de abril no habra sesiones por Semana Santa ✝️. ¡Disfruten su descanso! 🌿✨ | Usuarios Colombia 🇨🇴: sábado 4 de abril habrán sesiones normales 👍',
  color: '#ffffff',
  updatedBy: null,
  updatedAt: null,
}

async function fetchTicker(): Promise<TickerConfig> {
  try {
    const res = await fetch('/api/postgres/config/ticker')
    const json = await res.json()
    if (json.success && json.message) return json
    return DEFAULT_TICKER
  } catch {
    return DEFAULT_TICKER
  }
}

async function saveTicker(payload: { message: string; color: string }): Promise<TickerConfig> {
  const res = await fetch('/api/postgres/config/ticker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Error al guardar el ticker')
  return json.data
}

export default function TickerPage() {
  const queryClient = useQueryClient()

  const { data: current, isLoading } = useQuery<TickerConfig>(
    'ticker-config',
    fetchTicker,
    { staleTime: 0 }
  )

  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [newText, setNewText] = useState('')
  const [color, setColor] = useState('#ffffff')
  const [colorTouched, setColorTouched] = useState(false)
  const [saved, setSaved] = useState(false)

  // Sync color from DB only on first load (don't overwrite user selection)
  useEffect(() => {
    if (current?.color && !colorTouched) setColor(current.color)
  }, [current?.color])

  const previewMessage =
    mode === 'append' && current?.message
      ? `${current.message}  •  ${newText || '...'}`
      : newText || current?.message || ''

  const mutation = useMutation(saveTicker, {
    onSuccess: () => {
      queryClient.invalidateQueries('ticker-config')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      toast.success('Ticker actualizado')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Error al guardar')
    },
  })

  const handleSave = () => {
    const finalMessage =
      mode === 'append' && current?.message
        ? `${current.message}  •  ${newText.trim()}`
        : newText.trim()

    if (!finalMessage) {
      toast.error('El mensaje no puede estar vacío')
      return
    }

    const confirmed = window.confirm(
      `¿Confirmas actualizar el ticker del panel de estudiantes?\n\nMensaje: "${finalMessage.substring(0, 120)}${finalMessage.length > 120 ? '…' : ''}"`
    )
    if (!confirmed) return

    mutation.mutate({ message: finalMessage, color })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Volver al Dashboard
        </Link>
        <div className="h-4 w-px bg-gray-300" />
        <div className="flex items-center gap-2">
          <MegaphoneIcon className="h-5 w-5 text-primary-600" />
          <h1 className="text-lg font-semibold text-gray-900">Editor de Ticker</h1>
        </div>
        {saved && (
          <div className="ml-auto flex items-center gap-1.5 text-green-600 text-sm font-medium">
            <CheckCircleIcon className="h-4 w-4" />
            Guardado
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Current ticker preview */}
        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Mensaje actual en producción
          </h2>
          {isLoading ? (
            <div className="h-10 bg-gray-100 rounded animate-pulse" />
          ) : (
            <>
              <TickerPreview message={current?.message ?? ''} color={current?.color ?? '#ffffff'} />
              {current?.updatedBy && (
                <p className="text-xs text-gray-400">
                  Última actualización por <span className="font-medium">{current.updatedBy}</span>
                  {current.updatedAt && (
                    <> · {new Date(current.updatedAt).toLocaleString('es-CO')}</>
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {/* Editor */}
        <div className="card p-5 space-y-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Editar mensaje
          </h2>

          {/* Mode selector */}
          <div className="flex gap-3">
            {(['replace', 'append'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  mode === m
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'
                }`}
              >
                {m === 'replace' ? 'Reemplazar' : 'Agregar al final'}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              {mode === 'replace' ? 'Nuevo mensaje' : 'Texto a agregar'}
            </label>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={
                mode === 'replace'
                  ? 'Escribe el nuevo mensaje completo...'
                  : 'Texto que se añadirá al final del mensaje actual...'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
            <p className="text-xs text-gray-400 text-right">{newText.length}/1000</p>
          </div>

          {/* Color picker */}
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Color de texto</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => { setColor(e.target.value); setColorTouched(true) }}
                className="h-9 w-16 rounded cursor-pointer border border-gray-300"
                title="Seleccionar color"
              />
              <span className="text-sm text-gray-500 font-mono">{color}</span>
              <button
                onClick={() => { setColor('#ffffff'); setColorTouched(true) }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Restablecer blanco
              </button>
            </div>
          </div>
        </div>

        {/* Preview result */}
        {newText && (
          <div className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Vista previa del resultado
            </h2>
            <TickerPreview message={previewMessage} color={color} />
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={mutation.isLoading || !newText.trim()}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isLoading ? 'Guardando...' : 'Guardar y publicar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TickerPreview({ message, color }: { message: string; color: string }) {
  return (
    <div className="bg-gray-900 overflow-hidden flex items-stretch rounded-lg">
      <style>{`
        @keyframes ticker-preview {
          0%   { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .ticker-preview-text {
          display: inline-block;
          white-space: nowrap;
          animation: ticker-preview 20s linear infinite;
        }
      `}</style>
      <div className="flex-shrink-0 bg-blue-600 flex items-center px-4 py-2 gap-2">
        <span className="text-white text-xs font-black uppercase tracking-widest">📢 MOSAICO</span>
      </div>
      <div className="flex-1 overflow-hidden flex items-center py-2">
        <span
          className="ticker-preview-text text-sm font-medium px-8"
          style={{ color }}
        >
          {message}
        </span>
      </div>
    </div>
  )
}
