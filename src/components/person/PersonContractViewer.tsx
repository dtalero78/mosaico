'use client'

import { useState, useRef } from 'react'
import { EyeIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { api } from '@/hooks/use-api'
import { fillContractTemplate, type ConsentDisplay } from '@/lib/contract-template-filler'

interface PersonForViewer {
  _id: string
  primerNombre?: string
  primerApellido?: string
  contrato?: string
  plataforma?: string
  tipoUsuario?: string
  titularId?: string | null
}

interface Props {
  person: PersonForViewer
}

/**
 * Read-only contract viewer for the /person/[id] header.
 * Mirrors the comercial detail page's "Ver Contrato" modal but exposes
 * ONLY a Close button — no print/sign/PDF actions.
 *
 * Resolves the contract owner (titularId):
 *   - tipoUsuario === 'TITULAR'      → person._id
 *   - tipoUsuario === 'BENEFICIARIO' → person.titularId
 *
 * Disabled with a tooltip when the person has no `plataforma` or no contract
 * owner can be resolved.
 */
export default function PersonContractViewer({ person }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [contractHtml, setContractHtml] = useState('')
  const [loading, setLoading] = useState(false)

  const titularId =
    person.tipoUsuario === 'TITULAR' ? person._id : (person.titularId || null)

  const fullName = [person.primerNombre, person.primerApellido].filter(Boolean).join(' ')

  // Disabled reason (null = enabled)
  const disabledReason: string | null = !person.plataforma
    ? 'Sin plataforma asignada'
    : !titularId
      ? 'No se puede resolver el titular del contrato'
      : null

  const openContract = async () => {
    if (disabledReason || !titularId) return
    setShowModal(true)
    setLoading(true)
    try {
      // Three calls in parallel: contract data, template, consent status
      const [contractData, templateRes, consentStatus] = await Promise.all([
        api.get(`/api/postgres/contracts/${titularId}`),
        api.get(
          `/api/postgres/contracts/template?plataforma=${encodeURIComponent(person.plataforma || '')}`
        ),
        api.get(`/api/consent/${titularId}/status`).catch(() => null as ConsentDisplay | null),
      ])

      const filled = fillContractTemplate(
        templateRes.template,
        contractData.titular,
        contractData.beneficiarios || [],
        contractData.financial || null,
        consentStatus || undefined,
        contractData.asesorInfo || null,
      )
      setContractHtml(filled)
    } catch (err: any) {
      console.error('[PersonContractViewer]', err)
      toast.error(err?.message || 'Error cargando el contrato')
      setShowModal(false)
    } finally {
      setLoading(false)
    }
  }

  const close = () => setShowModal(false)

  return (
    <>
      <button
        type="button"
        onClick={openContract}
        disabled={!!disabledReason || loading}
        title={disabledReason || ''}
        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <EyeIcon className="h-4 w-4" />
        {loading ? 'Cargando...' : 'Ver Contrato'}
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-start justify-center p-4 pt-10">
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={close}
              aria-hidden="true"
            />

            <div className="relative w-full max-w-4xl bg-white rounded-xl shadow-2xl">
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 rounded-t-xl">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Contrato {person.contrato || ''}
                  </h2>
                  <p className="text-sm text-gray-500">
                    Plataforma: {person.plataforma}
                    {fullName ? ` · ${fullName}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  title="Cerrar"
                  onClick={close}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              {/* Body */}
              <div className="px-8 py-6 max-h-[75vh] overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap font-serif text-gray-800 leading-relaxed">
                    {contractHtml}
                  </div>
                )}
              </div>

              {/* Footer — ONLY Cerrar */}
              <div className="sticky bottom-0 flex items-center justify-end px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 text-sm font-medium"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
