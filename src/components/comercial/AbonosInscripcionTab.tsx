'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import PagoTitularWizard from '@/components/person/PagoTitularWizard'

interface Encontrado {
  titular: any
  pagos: any[]
  saldo: number
  realizadoPor: string
}

const nombreDe = (t: any) =>
  [t.primerNombre, t.segundoNombre, t.primerApellido, t.segundoApellido].filter(Boolean).join(' ')

/**
 * Gestión Contrato › "Abonos Inscripción".
 * Se pide el número de contrato y el ID del titular, se muestra el titular para
 * confirmar y se abre el MISMO modal de pago de Recaudos, sin Último Pago /
 * Penalidad / Cambio Contado, y a nombre del comercial que lo registra.
 */
export default function AbonosInscripcionTab() {
  const [contrato, setContrato] = useState('')
  const [numeroId, setNumeroId] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [hallado, setHallado] = useState<Encontrado | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [pagoAbierto, setPagoAbierto] = useState(false)

  const buscar = async () => {
    if (!contrato.trim() || !numeroId.trim()) { toast.error('Escribe el contrato y el ID del titular'); return }
    setBuscando(true)
    try {
      const qs = new URLSearchParams({ contrato: contrato.trim(), numeroId: numeroId.trim() })
      const res = await fetch(`/api/postgres/comercial/abonos-inscripcion?${qs}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || j.error) throw new Error(
        res.status === 404 ? 'No se encontró un titular con ese contrato e ID (o está fuera de tu equipo).' : (j.error || 'Error al buscar'))
      setHallado({ titular: j.titular, pagos: j.pagos || [], saldo: j.saldo || 0, realizadoPor: j.realizadoPor || '' })
      setConfirmando(true)
    } catch (e: any) {
      toast.error(e?.message || 'Error al buscar')
    } finally {
      setBuscando(false)
    }
  }

  const limpiar = () => { setContrato(''); setNumeroId(''); setHallado(null); setConfirmando(false); setPagoAbierto(false) }

  return (
    <div>
      <p className="text-gray-500 mb-4 text-sm">
        Registra un <strong>abono a la inscripción</strong> de un titular. Escribe el <strong>número de contrato</strong> y el{' '}
        <strong>ID del titular</strong>; antes de registrar verás el titular para confirmar. El abono queda a tu nombre y pasa a
        Recaudos › Verificación Inscripción.
      </p>

      <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="ab-contrato" className="text-xs font-medium text-gray-500 uppercase"># Contrato</label>
          <input id="ab-contrato" type="text" value={contrato} onChange={e => setContrato(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') buscar() }} placeholder="Ej. 01-M5-09455-26"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ab-id" className="text-xs font-medium text-gray-500 uppercase"># ID del titular</label>
          <input id="ab-id" type="text" value={numeroId} onChange={e => setNumeroId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') buscar() }} placeholder="Documento"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56" />
        </div>
        <button type="button" onClick={buscar} disabled={buscando}
          className="px-5 py-2 text-sm font-medium bg-purple-700 text-white rounded-lg hover:bg-purple-800 disabled:opacity-50">
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {/* Confirmación del titular */}
      {confirmando && hallado && !pagoAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900">Confirma el titular</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-gray-500">Titular</dt><dd className="font-semibold text-gray-900 text-right">{nombreDe(hallado.titular)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-500">ID</dt><dd className="font-medium text-gray-900">{hallado.titular.numeroId}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-500">Contrato</dt><dd className="font-medium text-gray-900">{hallado.titular.contrato}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-500">Plataforma</dt><dd className="font-medium text-gray-900">{hallado.titular.plataforma || '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-500">Lo registra</dt><dd className="font-medium text-gray-900">{hallado.realizadoPor || '—'}</dd></div>
            </dl>
            <p className="mt-4 text-sm text-gray-600">¿Registrar un abono a la inscripción de este titular?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={limpiar}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={() => setPagoAbierto(true)}
                className="px-4 py-2 text-sm font-medium bg-purple-700 text-white rounded-lg hover:bg-purple-800">Confirmar y continuar</button>
            </div>
          </div>
        </div>
      )}

      {hallado && (
        <PagoTitularWizard
          isOpen={pagoAbierto}
          onClose={limpiar}
          titular={hallado.titular}
          existingPagos={hallado.pagos}
          saldoActual={hallado.saldo}
          modo="abono-inscripcion"
          realizadoPor={hallado.realizadoPor}
          postUrl="/api/postgres/comercial/abonos-inscripcion"
          onCreated={limpiar}
        />
      )}
    </div>
  )
}
