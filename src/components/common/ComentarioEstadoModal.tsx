'use client'

/**
 * Pide el COMENTARIO obligatorio de un cambio de estado de aprobación (regla única en
 * lib/comentario-aprobacion): aprobar un beneficiario (adición/reemplazo) o pasar a
 * Rechazado, Devuelto, Contrato nulo, Pendiente, Retractado… El comentario queda en
 * APROBACION_AUDIT con quién, fecha y hora, y se ve en el Seguimiento del contrato.
 */

import { useState } from 'react'
import { MIN_COMENTARIO_ESTADO } from '@/lib/comentario-aprobacion'

export default function ComentarioEstadoModal({
  titulo, descripcion, estadoNuevo, placeholder, confirmarTexto, onConfirm, onClose,
}: {
  titulo: string
  descripcion?: React.ReactNode
  estadoNuevo: string
  placeholder?: string
  confirmarTexto?: string
  onConfirm: (comentario: string) => Promise<void> | void
  onClose: () => void
}) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const largo = texto.trim().length
  const ok = largo >= MIN_COMENTARIO_ESTADO
  const aprobar = estadoNuevo === 'Aprobado'

  const confirmar = async () => {
    if (!ok || enviando) return
    setEnviando(true)
    try { await onConfirm(texto.trim()) } finally { setEnviando(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 text-left" onClick={() => !enviando && onClose()}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900">{titulo}</h3>
        {descripcion && <div className="mt-1 text-sm text-gray-600">{descripcion}</div>}
        <label className="mt-4 block text-sm font-medium text-gray-700">
          {aprobar ? 'Comentario' : 'Motivo'} <span className="text-red-600">*</span>
        </label>
        <textarea autoFocus value={texto} onChange={e => setTexto(e.target.value)} rows={4} maxLength={1000}
          placeholder={placeholder || (aprobar
            ? 'Ej.: adición de beneficiario solicitada por el titular / reemplaza a …'
            : `¿Por qué pasa a "${estadoNuevo}"?`)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500" />
        <p className={`mt-1 text-xs ${ok ? 'text-gray-500' : 'text-amber-700'}`}>
          {ok ? 'Queda en el Seguimiento con tu nombre, fecha y hora.' : `Mínimo ${MIN_COMENTARIO_ESTADO} caracteres (${largo}/${MIN_COMENTARIO_ESTADO}).`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={enviando}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={!ok || enviando}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${aprobar ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
            {enviando ? 'Guardando…' : (confirmarTexto || (aprobar ? 'Aprobar' : `Pasar a ${estadoNuevo}`))}
          </button>
        </div>
      </div>
    </div>
  )
}
