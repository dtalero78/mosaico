'use client'

import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

/**
 * Resultado del WhatsApp automático (confirmación de taller/olimpiada, aviso de
 * nivelación programada). Verde si salieron todos, rojo con la causa de cada
 * uno que falló; ámbar si fue mixto.
 *
 * Es un tipo propio del cliente (espejo de `ResultadoWhatsApp` del servicio, que
 * es server-only y no se puede importar aquí).
 */
export interface WhatsAppResultado {
  ok: boolean
  motivo?: string
  nombre?: string
  destino?: 'apoderado' | 'alumno'
  telefono?: string
}

interface Props {
  resultados: WhatsAppResultado[]
  onClose: () => void
  /** Título del contexto, p. ej. "Inscripción al taller". */
  titulo?: string
}

export default function WhatsAppResultadoModal({ resultados, onClose, titulo }: Props) {
  if (!resultados.length) return null
  const enviados = resultados.filter(r => r.ok)
  const fallidos = resultados.filter(r => !r.ok)
  const todoOk = fallidos.length === 0
  const nadaOk = enviados.length === 0
  const tono = todoOk
    ? { caja: 'bg-green-50 border-green-200', icono: 'text-green-600', titulo: 'text-green-800', btn: 'bg-green-600 hover:bg-green-700' }
    : nadaOk
      ? { caja: 'bg-red-50 border-red-200', icono: 'text-red-600', titulo: 'text-red-800', btn: 'bg-red-600 hover:bg-red-700' }
      : { caja: 'bg-amber-50 border-amber-200', icono: 'text-amber-600', titulo: 'text-amber-800', btn: 'bg-amber-600 hover:bg-amber-700' }
  const Icono = todoOk ? CheckCircleIcon : nadaOk ? XCircleIcon : ExclamationTriangleIcon
  const encabezado = todoOk
    ? (resultados.length === 1 ? 'Mensaje de WhatsApp enviado con éxito' : `${enviados.length} mensajes de WhatsApp enviados con éxito`)
    : nadaOk
      ? (resultados.length === 1 ? 'No se pudo enviar el WhatsApp' : 'No se pudo enviar ningún WhatsApp')
      : `${enviados.length} enviado(s) · ${fallidos.length} con error`
  const aQuien = (r: WhatsAppResultado) =>
    [r.destino === 'apoderado' ? 'al apoderado' : r.destino === 'alumno' ? 'al alumno' : '', r.telefono].filter(Boolean).join(' ')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-2xl border shadow-xl bg-white overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-5 border-b ${tono.caja} flex items-start gap-3`}>
          <Icono className={`h-8 w-8 flex-shrink-0 ${tono.icono}`} />
          <div>
            {titulo && <p className="text-xs uppercase tracking-wide text-gray-500">{titulo}</p>}
            <h3 className={`text-lg font-semibold ${tono.titulo}`}>{encabezado}</h3>
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100">
          {resultados.map((r, i) => (
            <li key={i} className="px-5 py-3 text-sm flex items-start gap-2">
              {r.ok
                ? <CheckCircleIcon className="h-5 w-5 text-green-600 flex-shrink-0" />
                : <XCircleIcon className="h-5 w-5 text-red-600 flex-shrink-0" />}
              <div className="min-w-0">
                {r.nombre && <p className="font-medium text-gray-900">{r.nombre}</p>}
                {r.ok
                  ? <p className="text-green-700">Enviado {aQuien(r)}</p>
                  : <p className="text-red-700">{r.motivo || 'Error desconocido'}{aQuien(r) ? ` (${aQuien(r)})` : ''}</p>}
              </div>
            </li>
          ))}
        </ul>
        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className={`px-4 py-2 rounded-lg text-white text-sm font-medium ${tono.btn}`}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
