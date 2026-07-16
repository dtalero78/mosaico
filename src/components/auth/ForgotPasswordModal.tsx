'use client'

import { useState } from 'react'
import { EyeIcon, EyeSlashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

type Step = 'EMAIL' | 'IDENTITY' | 'OTP' | 'NEW_PASSWORD' | 'SUCCESS'

interface ForgotPasswordModalProps {
  initialEmail?: string
  onClose: () => void
}

export default function ForgotPasswordModal({ initialEmail = '', onClose }: ForgotPasswordModalProps) {
  const [step,          setStep]          = useState<Step>('EMAIL')
  const [email,         setEmail]         = useState(initialEmail)
  // El celular enmascarado sólo se conoce DESPUÉS de verificarlo (lo devuelve
  // verify-identity): mostrarlo antes sería dar la respuesta del paso 2.
  const [maskedPhone,   setMaskedPhone]   = useState('')
  const [celular,       setCelular]       = useState('')
  const [otp,           setOtp]           = useState('')
  // Ticket que emite verify-otp: sin él, reset-password rechaza el cambio.
  const [resetToken,    setResetToken]    = useState('')
  const [password,      setPassword]      = useState('')
  const [confirm,       setConfirm]       = useState('')
  const [showPass,      setShowPass]      = useState(false)
  const [showConfirm,   setShowConfirm]   = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [showMismatch,  setShowMismatch]  = useState(false)

  // ── Step 1: check email ─────────────────────────────────────────────────
  const handleCheckEmail = async () => {
    if (!email.trim()) { toast.error('Ingrese su email'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-password/check-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Email no encontrado')
      setStep('IDENTITY')
    } catch (e: any) {
      toast.error(e.message)
    } finally { setLoading(false) }
  }

  // ── Step 2: verify identity ─────────────────────────────────────────────
  const handleVerifyIdentity = async () => {
    if (!celular.trim()) { toast.error('Ingrese su número de celular'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-password/verify-identity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), celular }),
      })
      const data = await res.json()
      if (!data.success) {
        if (data.mismatch) { setShowMismatch(true); return }
        throw new Error(data.error || 'Error al verificar')
      }
      // Ya demostró conocer el celular → recién ahora se puede mostrar enmascarado.
      setMaskedPhone(data.maskedPhone || '')
      toast.success('Código enviado por WhatsApp')
      setStep('OTP')
    } catch (e: any) {
      toast.error(e.message)
    } finally { setLoading(false) }
  }

  // ── Step 3: verify OTP ──────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (!otp.trim()) { toast.error('Ingrese el código'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-password/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: otp.trim() }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Código inválido')
      // El ticket es lo único que habilita el paso 4.
      if (!data.resetToken) throw new Error('No se pudo validar el código. Reinicia el proceso.')
      setResetToken(data.resetToken)
      setStep('NEW_PASSWORD')
    } catch (e: any) {
      toast.error(e.message)
    } finally { setLoading(false) }
  }

  // ── Step 4: reset password ──────────────────────────────────────────────
  const handleResetPassword = async () => {
    if (!password.trim()) { toast.error('Ingrese la nueva contraseña'); return }
    if (password.length < 6 || password.length > 10) { toast.error('La contraseña debe tener entre 6 y 10 caracteres'); return }
    if (/\s/.test(password)) { toast.error('La contraseña no puede contener espacios'); return }
    if (password !== confirm) { toast.error('Las contraseñas no coinciden'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-password/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, confirmPassword: confirm, resetToken }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error al actualizar')
      setStep('SUCCESS')
    } catch (e: any) {
      toast.error(e.message)
    } finally { setLoading(false) }
  }

  // ── Mismatch modal ──────────────────────────────────────────────────────
  if (showMismatch) {
    return (
      <Overlay>
        <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
          <div className="bg-red-600 px-6 py-4">
            <h2 className="text-lg font-bold text-white">Datos no coinciden</h2>
          </div>
          <div className="px-6 py-5 space-y-3">
            <p className="text-sm text-gray-700">
              Los datos ingresados no coinciden con los registrados en nuestra plataforma.
            </p>
            <p className="text-sm text-gray-500">Por seguridad, contacta a MOSAICO para restablecer tu contraseña.</p>
          </div>
          <div className="px-6 py-4 bg-gray-50 border-t flex justify-end">
            <button type="button" onClick={onClose}
              className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700">
              Volver al inicio de sesión
            </button>
          </div>
        </div>
      </Overlay>
    )
  }

  // ── Success ─────────────────────────────────────────────────────────────
  if (step === 'SUCCESS') {
    return (
      <Overlay>
        <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">¡Contraseña actualizada!</h2>
          <p className="text-sm text-gray-500 mb-6">Ya puedes iniciar sesión con tu nueva contraseña.</p>
          <button type="button" onClick={onClose}
            className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700">
            Ir al inicio de sesión
          </button>
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">

        {/* Header */}
        <div className="bg-primary-600 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Restablecer contraseña</h2>
            <p className="text-primary-100 text-xs mt-0.5">
              {step === 'EMAIL'        && 'Paso 1 de 4 — Verificar email'}
              {step === 'IDENTITY'     && 'Paso 2 de 4 — Verificar identidad'}
              {step === 'OTP'          && 'Paso 3 de 4 — Código de verificación'}
              {step === 'NEW_PASSWORD' && 'Paso 4 de 4 — Nueva contraseña'}
            </p>
          </div>
          <button type="button" title="Cerrar" onClick={onClose}
            className="text-white hover:text-primary-200 p-1">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* ── Step 1: EMAIL ── */}
          {step === 'EMAIL' && (
            <>
              <p className="text-sm text-gray-600">Ingresa tu email y verificamos si está registrado.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={email} readOnly={!!initialEmail}
                  onChange={e => setEmail(e.target.value.toLowerCase())}
                  placeholder="tu@email.com"
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${initialEmail ? 'bg-gray-50 text-gray-600' : ''}`}
                />
              </div>
              <button type="button" onClick={handleCheckEmail} disabled={loading}
                className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-semibold text-sm hover:bg-primary-700 disabled:opacity-50">
                {loading ? 'Verificando...' : 'Continuar'}
              </button>
            </>
          )}

          {/* ── Step 2: IDENTITY ── */}
          {step === 'IDENTITY' && (
            <>
              <p className="text-sm text-gray-600">
                Para confirmar tu identidad, ingresa el número de celular registrado
                en tu cuenta. Te enviaremos ahí un código de verificación.
              </p>
              {/* A propósito NO se muestra el celular registrado: es justo el dato
                  que se pide. Se revela enmascarado en el paso del código, cuando
                  el usuario ya demostró conocerlo. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Número de celular
                  <span className="text-xs text-gray-400 ml-1">(con o sin indicativo, solo números)</span>
                </label>
                <input type="tel" value={celular}
                  onKeyDown={e => {
                    if (!/^\d$/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
                      e.preventDefault()
                    }
                  }}
                  onChange={e => setCelular(e.target.value.replace(/\D/g, ''))}
                  placeholder="Ej: 991039009"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <button type="button" onClick={handleVerifyIdentity} disabled={loading}
                className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-semibold text-sm hover:bg-primary-700 disabled:opacity-50">
                {loading ? 'Verificando...' : 'Verificar y enviar código'}
              </button>
            </>
          )}

          {/* ── Step 3: OTP ── */}
          {step === 'OTP' && (
            <>
              <p className="text-sm text-gray-600">
                Hemos enviado un código de 6 dígitos a tu celular <span className="font-medium">{maskedPhone}</span>.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código de verificación</label>
                <input type="text" value={otp} maxLength={6}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <button type="button" onClick={handleVerifyOtp} disabled={loading}
                className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-semibold text-sm hover:bg-primary-700 disabled:opacity-50">
                {loading ? 'Verificando...' : 'Verificar código'}
              </button>
            </>
          )}

          {/* ── Step 4: NEW PASSWORD ── */}
          {step === 'NEW_PASSWORD' && (
            <>
              <p className="text-sm text-gray-600">Crea tu nueva contraseña.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nueva contraseña <span className="text-xs text-gray-400">(6–10 caracteres)</span>
                </label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Nueva contraseña"
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
                <div className="relative">
                  <input type={showConfirm ? 'text' : 'password'} value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repite la contraseña"
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button type="button" onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showConfirm ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <button type="button" onClick={handleResetPassword} disabled={loading}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-50">
                {loading ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </>
          )}

        </div>
      </div>
    </Overlay>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      {children}
    </div>
  )
}
