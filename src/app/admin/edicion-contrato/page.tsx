'use client'

import { useState } from 'react'
import { MagnifyingGlassIcon, ArrowTopRightOnSquareIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
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

const BASE_URL = 'https://lgs-plataforma.com/dashboard/comercial/contrato'

function fullName(p: any) {
  return [p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido]
    .filter(Boolean).join(' ')
}

export default function EdicionContratoPage() {
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<ContractResult | null>(null)
  const [notFound, setNotFound] = useState(false)

  const isDirectId = (val: string) => val.trim().startsWith('prs_')

  const handleSearch = async () => {
    const val = input.trim()
    if (!val) { toast.error('Ingrese un ID o número de contrato'); return }

    setLoading(true)
    setResult(null)
    setNotFound(false)

    try {
      if (isDirectId(val)) {
        // Direct _id — build URL immediately, no API call needed
        setResult({ contrato: '—', titular: { _id: val, primerNombre: '', primerApellido: '', numeroId: '', tipoUsuario: 'TITULAR' }, beneficiarios: [] })
      } else {
        // Search by contract number
        const res  = await fetch(`/api/postgres/contracts/search?pattern=${encodeURIComponent(val)}&exact=true`)
        const data = await res.json()

        if (!data.success || data.contracts.length === 0) {
          // Try partial match
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

  const handleOpen = (id: string) => {
    window.open(`${BASE_URL}/${id}`, '_blank', 'noopener,noreferrer')
  }

  const titular = result?.titular
  const contractUrl = titular ? `${BASE_URL}/${titular._id}` : null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <DocumentTextIcon className="h-6 w-6 text-blue-600" />
        <h1 className="text-xl font-bold text-gray-900">Edición de Contrato</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">

        {/* Search box */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Buscar titular por:</p>
            <p className="text-xs text-gray-500">
              ID directo (ej: <code className="bg-gray-100 px-1 rounded">prs_1777175219970_zij89p664</code>) o
              número de contrato (ej: <code className="bg-gray-100 px-1 rounded">01-15256-26</code>)
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setResult(null); setNotFound(false) }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="prs_... o 01-15256-26"
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
                : <MagnifyingGlassIcon className="h-4 w-4" />
              }
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
        {result && titular && contractUrl && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Card header */}
            <div className="bg-blue-600 px-6 py-4">
              <p className="text-xs text-blue-200 uppercase font-semibold tracking-wide mb-1">Contrato encontrado</p>
              <p className="text-white font-bold text-lg">
                {result.contrato !== '—' ? `Contrato ${result.contrato}` : 'ID directo'}
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Titular info */}
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

              {/* URL preview */}
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Endpoint</p>
                <p className="text-xs font-mono text-gray-600 break-all">{contractUrl}</p>
              </div>

              {/* Open button */}
              <button
                type="button"
                onClick={() => handleOpen(titular._id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-semibold text-sm"
              >
                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                Abrir Edición del Contrato
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
