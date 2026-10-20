'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Selector de emojis liviano (sin dependencias). Lista curada para los mensajes
 * de WhatsApp de MOSAICO: saludos, clases, avisos, fechas y cierre.
 * WhatsApp los muestra tal cual porque viajan como texto UTF-8.
 */
const CATEGORIAS: Array<{ nombre: string; emojis: string[] }> = [
  { nombre: 'Caras', emojis: ['😊', '😀', '😃', '😄', '😁', '🙂', '😉', '😍', '🥰', '🤗', '🤩', '😎', '🤔', '😅', '😢', '🙏', '👏', '🙌', '💪', '👍', '👋', '✌️', '🤝', '👀'] },
  { nombre: 'Corazones', emojis: ['💙', '💜', '💚', '💛', '🧡', '❤️', '🤍', '💖', '💕', '✨', '⭐', '🌟', '🎉', '🎊', '🥳', '🏆', '🥇', '🎁'] },
  { nombre: 'Clases', emojis: ['📚', '📖', '📝', '✏️', '🖊️', '🎓', '🏫', '🧮', '🔢', '➕', '➖', '✖️', '➗', '🧠', '💡', '🎯', '🧩', '🎨'] },
  { nombre: 'Avisos', emojis: ['📌', '📍', '📢', '📣', '🔔', '⚠️', '❗', '❓', 'ℹ️', '✅', '☑️', '✔️', '❌', '🚫', '⛔', '🔁', '🔄', '➡️', '👉', '⬇️', '🔗', '🆕'] },
  { nombre: 'Tiempo', emojis: ['📅', '🗓️', '⏰', '⏳', '⌛', '🕐', '🕒', '🕕', '🕘', '☀️', '🌙', '📆'] },
  { nombre: 'Contacto', emojis: ['💻', '📱', '📲', '📞', '☎️', '💬', '✉️', '📧', '📩', '🌐', '🎥', '📹', '🎧', '🔐', '🔑', '👤', '👨‍👩‍👧', '👦', '👧', '🧑‍🏫'] },
]

export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full"
        title="Insertar emoji"
      >
        😊 Emojis
      </button>
      {open && (
        <div className="absolute z-50 left-0 bottom-full mb-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-2">
          <div className="flex flex-wrap gap-1 mb-2">
            {CATEGORIAS.map((c, i) => (
              <button
                key={c.nombre}
                type="button"
                onClick={() => setCat(i)}
                className={`text-[10px] px-2 py-0.5 rounded-full ${i === cat ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {c.nombre}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5 max-h-40 overflow-y-auto">
            {CATEGORIAS[cat].emojis.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => onSelect(em)}
                className="text-xl leading-none p-1 rounded hover:bg-gray-100"
                title={em}
              >
                {em}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Clic para insertar donde está el cursor. También puedes pegar cualquier emoji.</p>
        </div>
      )}
    </div>
  )
}
