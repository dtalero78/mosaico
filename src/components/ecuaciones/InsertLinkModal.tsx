'use client';

import { useState } from 'react';

/**
 * Modal para insertar un link markdown `[texto](url)` en un campo de contenido,
 * pregunta o respuesta. Sólo acepta http(s), rutas relativas o mailto.
 */
export default function InsertLinkModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (snippet: string) => void;
}) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');

  if (!open) return null;

  const cleanText = text.trim().replace(/[\[\]()]/g, '');
  const okUrl = /^(https?:\/\/|\/|mailto:)/i.test(url.trim()) && !/[\s)]/.test(url.trim());
  const snippet = cleanText && okUrl ? `[${cleanText}](${url.trim()})` : '';

  const reset = () => { setText(''); setUrl(''); };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Insertar link</h3>
          <button type="button" onClick={onClose} title="Cerrar"
            className="p-1 text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <label className="block text-xs font-medium text-gray-500 mb-1">Texto visible</label>
        <input value={text} onChange={(e) => setText(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
          placeholder="Ver enlace" />

        <label className="block text-xs font-medium text-gray-500 mb-1">URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          placeholder="https://…" />
        {url.trim() && !okUrl && (
          <p className="text-xs text-red-500 mt-1">URL inválida (usa http(s)://, /ruta o mailto: y sin espacios).</p>
        )}

        {snippet && (
          <div className="mt-3 text-[11px] text-gray-400 font-mono break-all">{snippet}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => { onClose(); reset(); }}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" disabled={!snippet}
            onClick={() => { onInsert(snippet); onClose(); reset(); }}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Insertar
          </button>
        </div>
      </div>
    </div>
  );
}
