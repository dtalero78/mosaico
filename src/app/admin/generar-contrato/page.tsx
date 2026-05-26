'use client'

/**
 * /admin/generar-contrato — Mantenimiento > Usuarios > Generar Contrato.
 *
 * Permite buscar un titular por número de contrato o por `_id` directo
 * (formato `prs_...` o UUID Wix), y regenerar el PDF del contrato subiéndolo
 * al Drive vía bsl-utilidades, SOBRESCRIBIENDO el PDF anterior por
 * `documento: titularId`. NO envía WhatsApp al cliente.
 *
 * Útil cuando se detectó un error en un contrato ya generado (ej: valores
 * financieros vacíos por el bug de send-pdf usando `titularId` en lugar
 * de `contrato`) y se quiere corregir el archivo en Drive sin re-notificar.
 *
 * Permiso: MANTENIMIENTO.USUARIOS.GENERAR_CONTRATO (SUPER_ADMIN/ADMIN bypass).
 * Ruta gateada en middleware + sidebar.
 */

import { useState } from 'react'
import { MagnifyingGlassIcon, ArrowPathIcon, DocumentTextIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface ContractResult {
  contrato: string
  titular: {
    _id: string
    primerNombre: string
    segundoNombre?: string
    primerApellido: string
    segundoApellido?: string
    numeroId: string
    tipoUsuario: string
  } | null
  beneficiarios: any[]
}

interface RegenerateResult {
  pdfUrl: string
  driveUpload: any
  contrato: string
  titular: { _id: string; primerNombre: string; primerApellido: string; numeroId: string }
}

function fullName(p: any) {
  return [p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido]
    .filter(Boolean).join(' ')
}

const isDirectId = (val: string) =>
  val.trim().startsWith('prs_') ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim())

export default function GenerarContratoPage() {
  const [input,   setInput]    = useState('')
  const [loading, setLoading]  = useState(false)
  const [result,  setResult]   = useState<ContractResult | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [showConfirm,  setShowConfirm]  = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [success,      setSuccess]      = useState<RegenerateResult | null>(null)

  const handleSearch = async () => {
    const val = input.trim()
    if (!val) { toast.error('Ingrese un ID o número de contrato'); return }

    setLoading(true)
    setResult(null)
    setNotFound(false)
    setSuccess(null)

    try {
      if (isDirectId(val)) {
        setResult({
          contrato: '—',
          titular: { _id: val, primerNombre: '', primerApellido: '', numeroId: '', tipoUsuario: 'TITULAR' },
          beneficiarios: [],
        })
      } else {
        const res  = await fetch(`/api/postgres/contracts/search?pattern=${encodeURIComponent(val)}&exact=true`)
        const data = await res.json()
        if (!data.success || data.contracts.length === 0) {
          const res2  = await fetch(`/api/postgres/contracts/search?pattern=${encodeURIComponent(val)}`)
          const data2 = await res2.json()
          if (!data2.success || data2.contracts.length === 0) {
            setNotFound(true)
          } else {
            setResult(data2.contracts[0])
          }
        } else {
          setResult(data.contracts[0])
        }
      }
    } catch {
      toast.error('Error al buscar')
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerate = async () => {
    const titularId = result?.titular?._id
    if (!titularId) return
    setRegenerating(true)
    try {
      const res = await fetch(`/api/contracts/${titularId}/regenerate-drive`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error regenerando contrato')
      }
      setSuccess({
        pdfUrl: data.pdfUrl,
        driveUpload: data.driveUpload,
        contrato: data.contrato,
        titular: data.titular,
      })
      setShowConfirm(false)
      toast.success('Contrato regenerado y subido al Drive')
    } catch (e: any) {
      toast.error(e?.message || 'Error regenerando')
    } finally {
      setRegenerating(false)
    }
  }

  const titular = result?.titular

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <DocumentTextIcon className="h-6 w-6 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Generar Contrato (Drive)</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">

        {/* Info banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          Esta acción <strong>regenera el PDF del contrato</strong> y lo sube al Drive
          sobreescribiendo el archivo existente del titular. <strong>NO reenvía WhatsApp</strong>
          al cliente. Útil cuando se detecta un error en un contrato ya generado.
        </div>

        {/* Search box */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Buscar titular por:</p>
            <p className="text-xs text-gray-500">
              ID directo (ej: <code className="bg-gray-100 px-1 rounded">prs_177...</code> o
              UUID Wix), o número de contrato (ej: <code className="bg-gray-100 px-1 rounded">01-15194-26</code>)
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setResult(null); setNotFound(false); setSuccess(null) }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="prs_... o 01-15194-26"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              {loading
                ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <MagnifyingGlassIcon className="h-4 w-4" />}
              Buscar
            </button>
          </div>
        </div>

        {/* Not found */}
        {notFound && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            No se encontró ningún contrato con ese número. Verifique el valor ingresado.
          </div>
        )}

        {/* Result */}
        {result && titular && !success && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-blue-600 px-6 py-4">
              <p className="text-xs text-blue-200 uppercase font-semibold tracking-wide mb-1">Contrato encontrado</p>
              <p className="text-white font-bold text-lg">
                {result.contrato !== '—' ? `Contrato ${result.contrato}` : 'ID directo'}
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              {titular.primerNombre && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold mb-0.5">Titular</p>
                    <p className="text-gray-800 font-medium">{fullName(titular)}</p>
                  </div>
                  {titular.numeroId && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase font-semibold mb-0.5">Número de ID</p>
                      <p className="text-gray-800">{titular.numeroId}</p>
                    </div>
                  )}
                  {result.beneficiarios.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase font-semibold mb-0.5">Beneficiarios</p>
                      <p className="text-gray-800">{result.beneficiarios.length}</p>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-semibold text-sm"
              >
                <ArrowPathIcon className="h-5 w-5" />
                Regenerar PDF en Drive
              </button>
            </div>
          </div>
        )}

        {/* Success card */}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
              <h3 className="text-emerald-900 font-bold">Contrato regenerado</h3>
            </div>
            <div className="text-sm text-emerald-900 space-y-1">
              <p><strong>Contrato:</strong> {success.contrato}</p>
              <p><strong>Titular:</strong> {success.titular.primerNombre} {success.titular.primerApellido}</p>
              <p><strong>Documento:</strong> {success.titular.numeroId}</p>
            </div>
            <div className="bg-white rounded p-3 border border-emerald-200 text-xs">
              <p className="text-gray-500 mb-1 font-semibold uppercase">PDF generado</p>
              <a href={success.pdfUrl} target="_blank" rel="noopener noreferrer"
                 className="text-blue-600 hover:underline break-all">
                {success.pdfUrl}
              </a>
            </div>
            <div className="bg-white rounded p-3 border border-emerald-200 text-xs">
              <p className="text-gray-500 mb-1 font-semibold uppercase">Respuesta del Drive</p>
              <pre className="text-gray-700 overflow-x-auto">{JSON.stringify(success.driveUpload, null, 2)}</pre>
            </div>
            <button
              type="button"
              onClick={() => { setSuccess(null); setResult(null); setInput('') }}
              className="text-sm text-emerald-700 hover:text-emerald-900 underline"
            >
              Regenerar otro contrato
            </button>
          </div>
        )}

        {/* Confirm modal */}
        {showConfirm && titular && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Regenerar PDF y sobreescribir Drive
              </h3>
              <p className="text-sm text-gray-700 mb-4">
                Se generará un nuevo PDF del contrato <strong>{result?.contrato}</strong>
                ({fullName(titular) || titular._id}) y se subirá al Drive, sobreescribiendo
                el archivo existente del titular. <strong>NO se enviará WhatsApp.</strong>
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={regenerating}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {regenerating && (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  {regenerating ? 'Regenerando…' : 'Sí, regenerar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
