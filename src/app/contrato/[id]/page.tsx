'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { fillContractTemplate, type ConsentDisplay } from '@/lib/contract-template-filler'

type PageState = 'LOADING' | 'ERROR' | 'HAS_CONSENT' | 'DOCUMENT_ENTRY' | 'OTP_ENTRY' | 'VERIFIED'

export default function ContratoPublicoPage() {
  const params = useParams()
  const router = useRouter()
  const titularId = params.id as string

  const [pageState, setPageState] = useState<PageState>('LOADING')
  const [error, setError] = useState('')

  // Contract data
  const [titular, setTitular] = useState<any>(null)
  const [beneficiarios, setBeneficiarios] = useState<any[]>([])
  const [financial, setFinancial] = useState<any>(null)
  const [contractText, setContractText] = useState('')
  const [consentStatus, setConsentStatus] = useState<ConsentDisplay | null>(null)

  // OTP flow
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [celularMasked, setCelularMasked] = useState('')
  const [declaracionAceptada, setDeclaracionAceptada] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const loadData = useCallback(async () => {
    try {
      setPageState('LOADING')

      const [contractRes, statusRes] = await Promise.all([
        fetch(`/api/consent/${titularId}/contract-data`).then(r => r.json()),
        fetch(`/api/consent/${titularId}/status`).then(r => r.json()),
      ])

      if (contractRes.error) {
        setError(contractRes.error)
        setPageState('ERROR')
        return
      }

      const { titular: tit, beneficiarios: ben, financial: fin, template, asesorInfo } = contractRes

      setTitular(tit)
      setBeneficiarios(ben || [])
      setFinancial(fin || null)

      const consent: ConsentDisplay | null = statusRes.error ? null : statusRes
      setConsentStatus(consent)

      // Fill template
      const filled = fillContractTemplate(template || '', tit, ben || [], fin || null, consent || undefined, asesorInfo || null)
      setContractText(filled)

      if (consent?.hasConsent) {
        setPageState('HAS_CONSENT')
      } else {
        setPageState('DOCUMENT_ENTRY')
      }
    } catch {
      setError('Error cargando el contrato. Intenta de nuevo.')
      setPageState('ERROR')
    }
  }, [titularId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Redirect to LGS website after successful verification
  useEffect(() => {
    if (pageState !== 'VERIFIED') return
    const timer = setTimeout(() => {
      router.replace('https://letsgospeak.cl/')
    }, 2000)
    return () => clearTimeout(timer)
  }, [pageState, router])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  const handleSendOtp = async () => {
    if (!numeroDocumento.trim()) {
      setOtpError('Ingresa tu numero de documento')
      return
    }
    try {
      setSendingOtp(true)
      setOtpError('')
      const res = await fetch(`/api/consent/${titularId}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeroDocumento: numeroDocumento.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOtpError(data.error || 'Error enviando codigo')
        return
      }
      setCelularMasked(data.celularMasked || '')
      setResendCooldown(30)
      setPageState('OTP_ENTRY')
    } catch {
      setOtpError('Error de conexion. Intenta de nuevo.')
    } finally {
      setSendingOtp(false)
    }
  }

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    await handleSendOtp()
  }

  const handleVerify = async () => {
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setOtpError('Ingresa el codigo de 6 digitos')
      return
    }
    if (!declaracionAceptada) {
      setOtpError('Debes aceptar la declaracion de consentimiento')
      return
    }
    try {
      setVerifying(true)
      setOtpError('')
      const res = await fetch(`/api/consent/${titularId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpCode: otpCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOtpError(data.error || 'Codigo incorrecto o expirado')
        return
      }
      setConsentStatus({
        hasConsent: true,
        consent: {
          numeroDocumento: numeroDocumento,
          timestampAcceptacion: new Date().toISOString(),
          celularValidado: celularMasked,
        },
        hash: data.hash,
      })
      setPageState('VERIFIED')
    } catch {
      setOtpError('Error de conexion. Intenta de nuevo.')
    } finally {
      setVerifying(false)
    }
  }

  // ── Render ──

  if (pageState === 'LOADING') {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4" />
          <p className="text-gray-500">Cargando contrato...</p>
        </div>
      </PageShell>
    )
  }

  if (pageState === 'ERROR') {
    return (
      <PageShell>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-red-700 mb-2">Error</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 text-sm font-medium"
          >
            Reintentar
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {/* Titular info */}
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          Contrato {titular?.contrato || ''}
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          {[titular?.primerNombre, titular?.primerApellido].filter(Boolean).join(' ')}
        </p>
      </div>

      {/* Consent verified badge */}
      {(pageState === 'HAS_CONSENT' || pageState === 'VERIFIED') && consentStatus?.consent && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-blue-800 uppercase">
                Consentimiento Declarativo Verificado
              </h3>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-blue-700">
                {consentStatus.consent.numeroDocumento && (
                  <div><span className="font-medium">Documento:</span> {consentStatus.consent.numeroDocumento}</div>
                )}
                {consentStatus.consent.timestampAcceptacion && (
                  <div><span className="font-medium">Fecha:</span> {new Date(consentStatus.consent.timestampAcceptacion).toLocaleString('es-CO')}</div>
                )}
                {consentStatus.consent.celularValidado && (
                  <div><span className="font-medium">Celular:</span> {consentStatus.consent.celularValidado}</div>
                )}
                {consentStatus.hash && (
                  <div><span className="font-medium">Hash:</span> {consentStatus.hash.substring(0, 16)}...</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contract text */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 mb-6 max-h-[50vh] overflow-y-auto">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap font-serif text-gray-800 leading-relaxed text-sm">
          {contractText}
        </div>
      </div>

      {/* Document entry step */}
      {pageState === 'DOCUMENT_ENTRY' && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Firma Digital</h3>
          <p className="text-sm text-gray-500 mb-4">
            Ingresa tu numero de documento para recibir un codigo de verificacion por WhatsApp.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={numeroDocumento}
              onChange={(e) => { setNumeroDocumento(e.target.value); setOtpError('') }}
              placeholder="Numero de documento"
              className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
            />
            <button
              onClick={handleSendOtp}
              disabled={sendingOtp}
              className="px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {sendingOtp ? 'Enviando...' : 'Enviar Codigo'}
            </button>
          </div>
          {otpError && <p className="mt-2 text-sm text-red-600">{otpError}</p>}
        </div>
      )}

      {/* OTP entry step */}
      {pageState === 'OTP_ENTRY' && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Verificacion OTP</h3>
          <p className="text-sm text-gray-500 mb-4">
            Se envio un codigo de 6 digitos al WhatsApp {celularMasked ? `terminado en ${celularMasked}` : 'registrado'}.
          </p>

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={otpCode}
                onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError('') }}
                placeholder="Codigo de 6 digitos"
                maxLength={6}
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border text-center tracking-widest text-lg font-mono"
                onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              />
            </div>

            {/* Declaration checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={declaracionAceptada}
                onChange={(e) => { setDeclaracionAceptada(e.target.checked); setOtpError('') }}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 leading-relaxed">
                Declaro que he leido y acepto los terminos del contrato. Entiendo que esta firma digital
                tiene la misma validez que una firma manuscrita.
              </span>
            </label>

            {otpError && <p className="text-sm text-red-600">{otpError}</p>}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="flex-1 px-5 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {verifying ? 'Verificando...' : 'Confirmar Consentimiento'}
              </button>
              <button
                onClick={handleResendOtp}
                disabled={resendCooldown > 0 || sendingOtp}
                className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm disabled:opacity-50"
              >
                {resendCooldown > 0 ? `Reenviar (${resendCooldown}s)` : 'Reenviar Codigo'}
              </button>
              <button
                onClick={() => { setPageState('DOCUMENT_ENTRY'); setOtpCode(''); setOtpError('') }}
                className="px-4 py-2.5 text-gray-500 hover:text-gray-700 text-sm"
              >
                Cambiar documento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verified success */}
      {pageState === 'VERIFIED' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <svg className="h-12 w-12 text-green-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-bold text-green-800">Consentimiento Registrado</h3>
          <p className="text-sm text-green-700 mt-1">
            Tu consentimiento declarativo ha sido verificado y registrado exitosamente.
          </p>
        </div>
      )}
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">LGS</span>
          </div>
          <span className="font-semibold text-gray-900">Let&apos;s Go Speak</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-8">
        <div className="max-w-3xl mx-auto px-4 py-4 text-center text-xs text-gray-400">
          Let&apos;s Go Speak &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  )
}
