'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon } from '@heroicons/react/24/outline'
import InfoFinancieraForm from '@/components/contract/InfoFinancieraForm'
import { INFO_FINANCIERA_VACIA, validarInfoFinanciera, type InfoFinanciera } from '@/lib/info-financiera'

/**
 * Modal «InfoFinanciera» del detalle del contrato: el MISMO formulario del paso 6
 * de Crear Contrato, precargado con lo guardado. Al guardar, el servidor
 * actualiza FINANCIEROS, el titular y la cuota de inscripción, y regenera el
 * contrato en Drive.
 */
export default function InfoFinancieraModal({
  titularId, onClose, onSaved,
}: {
  titularId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [info, setInfo] = useState<InfoFinanciera>(INFO_FINANCIERA_VACIA)
  const [meta, setMeta] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [confirmar, setConfirmar] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`/api/postgres/contracts/${titularId}/info-financiera`, { cache: 'no-store' })
      .then(r => r.json())
      .then(res => {
        if (!vivo) return
        if (res.error) throw new Error(res.error)
        setInfo(res.info)
        setMeta(res)
      })
      .catch(e => { toast.error(e?.message || 'No se pudo cargar la información financiera'); onClose() })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
    // Sólo al abrir: `onClose` llega como función nueva en cada render del padre
    // y volvería a cargar (pisando lo que se esté escribiendo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titularId])

  const error = validarInfoFinanciera(info)

  const guardar = async () => {
    setGuardando(true)
    try {
      const res = await fetch(`/api/postgres/contracts/${titularId}/info-financiera`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      if (!res.cambios?.length) toast('No había cambios en la información financiera')
      else toast.success('Información financiera guardada')
      if (res.pdf?.ok) toast.success(`Contrato regenerado en Drive (${res.pdf.archivo})`)
      else if (res.pdf?.omitido) toast(res.pdf.omitido)
      else if (res.pdf?.error) toast.error(`Los datos se guardaron, pero el PDF no se regeneró: ${res.pdf.error}`, { duration: 8000 })
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
      setConfirmar(false)
    } finally { setGuardando(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">InfoFinanciera</h3>
            {meta?.contrato && <p className="text-xs text-gray-500">Contrato {meta.contrato}</p>}
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500 py-10 text-center">Cargando…</p>
          ) : (
            <>
              {meta?.aprobado && (
                <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                  El contrato ya está aprobado: la <b>vigencia</b> y el <b>Módulo</b> no se cambian aquí
                  (se usa «Extender vigencia» en la ficha del alumno).
                </p>
              )}
              {meta?.inscripcionVerificada && (
                <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                  Recaudos ya verificó la inscripción: su monto no se puede cambiar desde aquí.
                </p>
              )}
              {!meta?.tieneFinanciero && (
                <p className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-sm text-sky-900">
                  Este contrato no tenía información financiera: al guardar se crea.
                </p>
              )}
              <InfoFinancieraForm value={info} onChange={setInfo} pais={meta?.plataforma} titulo={null} />
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50">
          <button type="button" onClick={onClose} disabled={guardando}
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" onClick={() => setConfirmar(true)} disabled={loading || !!error || guardando}
            className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>

      {confirmar && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black bg-opacity-40">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h4 className="text-lg font-semibold text-gray-900 mb-2">¿Guardar la información financiera?</h4>
            <p className="text-sm text-gray-700">
              Se actualiza el contrato y se <b>vuelve a generar el PDF en Drive</b> con estos valores
              (no se envía nada por WhatsApp). El cambio queda registrado en los comentarios del titular.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(false)} disabled={guardando}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
                Volver
              </button>
              <button type="button" onClick={guardar} disabled={guardando}
                className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50">
                {guardando ? 'Guardando y regenerando…' : 'Guardar y regenerar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
