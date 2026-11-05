'use client'

/**
 * "El pago tiene dos recibos" — dos espacios (Recibo 1 / Recibo 2) para subir los
 * comprobantes de UN mismo pago (modal Registrar Pago).
 *
 * Con dos recibos el VALOR del pago lo digita el operador: este componente solo
 * sube los archivos (y, si `leerConIA`, lee cada uno y muestra el monto leído como
 * referencia, con su suma). El padre decide qué hace con los datos leídos.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/hooks/use-api'

export interface ReciboArchivo {
  url: string
  nombre: string
  tipo?: string
  fechaSubida?: string
  /** Monto que leyó la IA (solo referencia). */
  montoLeido?: number | null
}

interface Props {
  /** Carpeta de subida (PEOPLE._id del titular) para /api/contracts/[id]/upload-url. */
  carpetaId: string
  recibos: (ReciboArchivo | null)[]
  onChange: (recibos: (ReciboArchivo | null)[]) => void
  /** Lee cada recibo con IA al subirlo (requiere lectura de recibos habilitada). */
  leerConIA?: boolean
  /** Datos leídos de un recibo (índice 0 o 1), para que el padre precargue lo que quiera. */
  onLeido?: (indice: number, extraido: any) => void
  disabled?: boolean
}

export const fmtPesos = (n: number) => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)

/** Suma de los montos leídos por IA, o null si falta alguno. */
export function sumaLeida(recibos: (ReciboArchivo | null)[]): number | null {
  const montos = recibos.map(r => (r && r.montoLeido != null ? Number(r.montoLeido) : null))
  return montos.length === 2 && montos.every(m => m != null && Number.isFinite(m)) ? (montos[0]! + montos[1]!) : null
}

export default function RecibosDobles({ carpetaId, recibos, onChange, leerConIA, onLeido, disabled }: Props) {
  const [subiendo, setSubiendo] = useState<number | null>(null)

  const subir = async (indice: number, file: File) => {
    setSubiendo(indice)
    try {
      const fd = new FormData(); fd.append('file', file)
      const up = await fetch(`/api/contracts/${carpetaId}/upload-url`, { method: 'POST', body: fd })
      if (!up.ok) { const e = await up.json().catch(() => ({} as any)); throw new Error(e.details || e.error || `Error ${up.status}`) }
      const { publicUrl } = await up.json()
      let montoLeido: number | null = null
      if (leerConIA) {
        try {
          const d = await api.post<{ extraido: any }>('/api/postgres/pagos-titulares/leer-comprobante', { url: publicUrl })
          const e = d.extraido || {}
          montoLeido = e.monto != null && Number.isFinite(Number(e.monto)) ? Number(e.monto) : null
          onLeido?.(indice, e)
        } catch {
          toast.error(`No se pudo leer el recibo ${indice + 1}; quedó adjunto igual`)
        }
      }
      const nuevos = [...recibos]
      nuevos[indice] = { url: publicUrl, nombre: file.name, tipo: file.type, fechaSubida: new Date().toISOString(), montoLeido }
      onChange(nuevos)
      toast.success(`Recibo ${indice + 1} adjuntado`)
    } catch (e: any) {
      toast.error(`Error subiendo el recibo ${indice + 1}: ${e?.message || ''}`)
    } finally {
      setSubiendo(null)
    }
  }

  const elegir = (indice: number) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => { const f = input.files?.[0]; if (f) subir(indice, f); document.body.removeChild(input) })
    input.click()
  }

  const quitar = (indice: number) => {
    const nuevos = [...recibos]; nuevos[indice] = null; onChange(nuevos)
  }

  const suma = sumaLeida(recibos)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[0, 1].map(i => {
          const r = recibos[i]
          return (
            <div key={i} className={`rounded-md border p-2.5 text-sm ${r ? 'border-emerald-200 bg-emerald-50' : 'border-dashed border-gray-300 bg-white'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-800">Recibo {i + 1}</span>
                {r ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => elegir(i)} disabled={disabled || subiendo !== null}
                      className="text-xs text-primary-600 hover:underline disabled:opacity-50">Cambiar</button>
                    <button type="button" onClick={() => quitar(i)} disabled={disabled || subiendo !== null}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50">Quitar</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => elegir(i)} disabled={disabled || subiendo !== null}
                    className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50">
                    {subiendo === i ? (leerConIA ? 'Leyendo…' : 'Subiendo…') : `Subir recibo ${i + 1}`}
                  </button>
                )}
              </div>
              {r && (
                <div className="mt-1 min-w-0">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-800 hover:underline break-all">{r.nombre}</a>
                  {leerConIA && (
                    <div className="text-xs text-gray-600">
                      Monto leído: {r.montoLeido != null ? <strong>{fmtPesos(Number(r.montoLeido))}</strong> : <span className="italic">no se pudo leer</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {leerConIA && suma != null && (
        <p className="text-xs text-gray-600">Suma leída de los dos recibos: <strong>{fmtPesos(suma)}</strong> (referencia — el valor se digita a mano).</p>
      )}
    </div>
  )
}
