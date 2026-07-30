'use client';

import { useState } from 'react';

/**
 * Modal para subir una imagen a DO Spaces (evaluaciones/) e insertar el token
 * markdown `![alt](url)` — donde url es el proxy estable
 * `/api/postgres/cursos-contenido/imagen?key=…`. Usado en pregunta/respuestas de
 * evaluación y en el temario. Necesita curso/code/step para la key.
 */
export default function InsertImageModal({
  open,
  onClose,
  onInsert,
  curso,
  code,
  step,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (snippet: string) => void;
  curso: string;
  code: string;
  step: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => { setFile(null); setAlt(''); setError(null); };

  const subir = async () => {
    if (!file) { setError('Elige una imagen'); return; }
    setUploading(true); setError(null);
    try {
      const presign = await fetch('/api/postgres/cursos-contenido/imagen-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, step, filename: file.name, contentType: file.type || 'image/png' }),
      }).then(r => r.json());
      if (!presign?.presignedUrl || !presign?.url) throw new Error(presign?.error || 'No se pudo preparar la subida');

      const put = await fetch(presign.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      if (!put.ok) throw new Error(`Falló la subida (${put.status})`);

      const altClean = (alt.trim() || file.name).replace(/[\[\]()]/g, '');
      onInsert(`![${altClean}](${presign.url})`);
      onClose(); reset();
    } catch (e: any) {
      setError(e?.message || 'Error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Insertar imagen</h3>
          <button type="button" onClick={onClose} title="Cerrar"
            className="p-1 text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <label className="block text-xs font-medium text-gray-500 mb-1">Archivo (imagen)</label>
        <input type="file" accept="image/*"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); }}
          className="w-full text-sm mb-3" />

        <label className="block text-xs font-medium text-gray-500 mb-1">Texto alternativo (opcional)</label>
        <input value={alt} onChange={(e) => setAlt(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          placeholder="Descripción de la imagen" />

        {file && (
          <div className="mt-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={URL.createObjectURL(file)} alt="preview" className="max-h-40 rounded border border-gray-200" />
          </div>
        )}
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => { onClose(); reset(); }} disabled={uploading}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" disabled={!file || uploading}
            onClick={subir}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {uploading ? 'Subiendo…' : 'Subir e insertar'}
          </button>
        </div>
      </div>
    </div>
  );
}
