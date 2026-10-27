'use client'

/**
 * "El pago tiene dos recibos" — dos espacios (Recibo 1 / Recibo 2) para subir los
 * comprobantes de UN mismo pago. Sólo sube los archivos; el valor del pago lo
 * digita quien opera (el padre lo pide) y la lectura con IA se hace al guardar.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import { ACCEPT_RECIBO, MAX_MB_RECIBO, reciboPermitido } from '@/lib/recibo-inscripcion'

export interface ReciboArchivo {
  url: string
  nombre: string
  tipo?: string
}

interface Props {
  /** PEOPLE._id (titular o beneficiario) para /api/contracts/[id]/upload-url. */
  carpetaId: string
  recibos: (ReciboArchivo | null)[]
  onChange: (recibos: (ReciboArchivo | null)[]) => void
  disabled?: boolean
}

export const fmtPesos = (n: number) => '$ ' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)

export default function RecibosDobles({ carpetaId, recibos, onChange, disabled }: Props) {
  const [subiendo, setSubiendo] = useState<number | null>(null)

  const subir = async (indice: number, file: File) => {
    if (!reciboPermitido(file.type, file.name)) { toast.error('El recibo debe ser una imagen JPG, PNG o WEBP, o un PDF.'); return }
    if (file.size > MAX_MB_RECIBO * 1024 * 1024) { toast.error(`El recibo supera ${MAX_MB_RECIBO} MB.`); return }
    setSubiendo(indice)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('proposito', 'recibo')
      const up = await fetch(`/api/contracts/${carpetaId}/upload-url`, { method: 'POST', body: fd })
      const j = await up.json().catch(() => ({} as any))
      if (!up.ok || !j.success) throw new Error(j.error || `Error ${up.status}`)
      const nuevos = [...recibos]
      nuevos[indice] = { url: j.publicUrl, nombre: file.name, tipo: file.type }
      onChange(nuevos)
    } catch (e: any) {
      toast.error(`Error subiendo el recibo ${indice + 1}: ${e?.message || ''}`)
    } finally {
      setSubiendo(null)
    }
  }

  const elegir = (indice: number) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT_RECIBO
    input.onchange = () => { const f = input.files?.[0]; if (f) subir(indice, f) }
    input.click()
  }

  const quitar = (indice: number) => {
    const nuevos = [...recibos]
    nuevos[indice] = null
    onChange(nuevos)
  }

  const bloqueado = disabled || subiendo !== null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {[0, 1].map(i => {
        const r = recibos[i]
        return (
          <div key={i} className={`rounded-md border p-2.5 text-sm ${r ? 'border-emerald-200 bg-emerald-50' : 'border-dashed border-gray-300 bg-white'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-800">Recibo {i + 1}</span>
              {r ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => elegir(i)} disabled={bloqueado}
                    className="text-xs text-indigo-600 hover:underline disabled:opacity-50">Cambiar</button>
                  <button type="button" onClick={() => quitar(i)} disabled={bloqueado}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50">Quitar</button>
                </div>
              ) : (
                <button type="button" onClick={() => elegir(i)} disabled={bloqueado}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50">
                  {subiendo === i ? 'Subiendo…' : `Subir recibo ${i + 1}`}
                </button>
              )}
            </div>
            {r && (
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="mt-1 block text-xs text-emerald-800 hover:underline break-all">{r.nombre}</a>
            )}
          </div>
        )
      })}
    </div>
  )
}
