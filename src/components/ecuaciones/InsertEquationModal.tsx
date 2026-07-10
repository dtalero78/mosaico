'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import MathText from './MathText';

// MathLive solo en el navegador.
const EquationField = dynamic(() => import('./EquationField'), { ssr: false });

/**
 * Modal para construir una ecuación con MathLive y devolver su LaTeX ya envuelto
 * en `$...$` (en línea) o `$$...$$` (bloque), listo para insertar en un textarea
 * de contenido o de una pregunta.
 */
export default function InsertEquationModal({
  open,
  onClose,
  onInsert,
  initial = '',
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (snippet: string) => void;
  initial?: string;
}) {
  const [latex, setLatex] = useState(initial);
  const [display, setDisplay] = useState(false);

  if (!open) return null;

  const snippet = latex.trim()
    ? (display ? `$$${latex.trim()}$$` : `$${latex.trim()}$`)
    : '';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Insertar ecuación</h3>
          <button type="button" onClick={onClose} title="Cerrar"
            className="p-1 text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <label className="block text-xs font-medium text-gray-500 mb-1">Editor</label>
        <EquationField initial={initial} onChange={setLatex} />

        <label className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
          Ecuación en bloque (centrada)
        </label>

        {latex.trim() && (
          <div className="mt-4">
            <div className="text-xs font-medium text-gray-500 mb-1">Vista previa</div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-center">
              <MathText block={display}>{snippet}</MathText>
            </div>
            <div className="mt-2 text-[11px] text-gray-400 font-mono break-all">{snippet}</div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" disabled={!snippet}
            onClick={() => { onInsert(snippet); onClose(); setLatex(''); }}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Insertar
          </button>
        </div>
      </div>
    </div>
  );
}
