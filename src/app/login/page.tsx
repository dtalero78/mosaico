'use client'

import { useState, useEffect, lazy, Suspense } from 'react'
const ForgotPasswordModal = lazy(() => import('@/components/auth/ForgotPasswordModal'))
import { signIn, getSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@/lib/zod-resolver'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { XMarkIcon, LockClosedIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

const BANNER_DISMISSED_KEY = 'lgs_banner_dismissed'

const loginSchema = z.object({
  // Identificador: correo (titulares/staff) o userLogin (estudiantes MOSAICO).
  email: z.string().min(3, 'Ingresa tu usuario o correo'),
  password: z.string().min(4, 'La contraseña debe tener al menos 4 caracteres'),
})

type LoginForm = z.infer<typeof loginSchema>

type LoginErrorType = 'BLOCKED' | 'EXPIRED' | null

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [loginError, setLoginError] = useState<LoginErrorType>(null)
  const [bannerImage, setBannerImage] = useState<string | null>(null)
  const [bannerVisible, setBannerVisible] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const router = useRouter()

  // Cargar banner al montar (GET público, sin auth)
  useEffect(() => {
    const dismissed = sessionStorage.getItem(BANNER_DISMISSED_KEY)
    if (dismissed) return

    fetch('/api/postgres/config/banner')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.active && data?.image) {
          setBannerImage(data.image)
          setBannerVisible(true)
        }
      })
      .catch(() => {})
  }, [])

  const handleDismissBanner = () => {
    setBannerVisible(false)
    sessionStorage.setItem(BANNER_DISMISSED_KEY, '1')
  }

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  // Check if we should redirect or stay on login
  useEffect(() => {
    async function checkAuth() {
      // COMENTADO: La lógica de bypass de auth está causando problemas
      // El archivo .env.local dice DISABLE_AUTH=false pero Codespaces tiene DISABLE_AUTH=true
      // Por ahora, SIEMPRE verificamos la sesión y NO bypaseamos auth
      /*
      if (isAuthDisabled()) {
        console.log('🔧 Auth is disabled, redirecting to /')
        router.push('/')
        return
      }
      */

      // Check if there's an active session
      const session = await getSession()
      console.log('🔍 Login page - session check:', {
        hasSession: !!session,
        user: session?.user?.email
      })

      // If there's a valid session, redirect to dashboard
      if (session?.user) {
        console.log('✅ Valid session found, redirecting to dashboard')
        router.push('/')
      } else {
        console.log('❌ No session, staying on login page')
      }
    }

    checkAuth()
  }, [router])

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      })

      if (result?.error) {
        if (result.error === 'BLOCKED') {
          setLoginError('BLOCKED')
        } else if (result.error === 'EXPIRED') {
          setLoginError('EXPIRED')
        } else {
          toast.error('Credenciales inválidas, verifique el usuario o la clave')
        }
      } else {
        toast.success('Inicio de sesión exitoso')

        // Get the session to check the user's role
        const session = await getSession()

        if (session?.user) {
          const userRole = (session.user as any).role
          const userEmail = session.user.email

          console.log('🔍 Login successful - Role:', userRole, 'Email:', userEmail)

          // Redirect advisors to their panel with email as URL param
          if (userRole === 'GUIA') {
            console.log('✅ Redirecting GUIA to panel-advisor with email:', userEmail)
            router.push(`/panel-advisor?email=${encodeURIComponent(userEmail || '')}`)
          } else if (userRole === 'ESTUDIANTE') {
            console.log('✅ Redirecting ESTUDIANTE to panel-estudiante')
            router.push('/panel-estudiante')
          } else {
            // Other roles go to homepage
            router.push('/')
          }
        } else {
          // Fallback to homepage if no session
          router.push('/')
        }
      }
    } catch (error) {
      toast.error('Error al iniciar sesión')
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>

    {/* Blocked Modal */}
    {loginError === 'BLOCKED' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 bg-red-100 rounded-full p-2">
              <LockClosedIcon className="h-6 w-6 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Acceso bloqueado</h2>
          </div>
          <p className="text-sm text-gray-600 mb-5">
            Tu cuenta ha sido desactivada. Por favor contacta al administrador para más información.
          </p>
          <button
            type="button"
            onClick={() => setLoginError(null)}
            className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    )}

    {/* Expired Contract Modal */}
    {loginError === 'EXPIRED' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 bg-amber-100 rounded-full p-2">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Contrato vencido</h2>
          </div>
          <p className="text-sm text-gray-600 mb-5">
            Tu contrato ha vencido y el acceso ha sido desactivado. Comunícate con MOSAICO para renovar tu plan.
          </p>
          <button
            type="button"
            onClick={() => setLoginError(null)}
            className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    )}

    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="relative max-w-md w-full space-y-8">

        {/* Banner Overlay */}
        {bannerVisible && bannerImage && (
          <>
            {/* Mobile: card centrado con backdrop — imagen a tamaño natural, sin distorsión */}
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:hidden">
              <div className="relative w-[88vw] max-w-sm rounded-xl overflow-hidden shadow-2xl bg-white">
                <button
                  type="button"
                  onClick={handleDismissBanner}
                  className="absolute top-2 right-2 z-20 bg-white rounded-full p-1.5 shadow-lg hover:bg-gray-100 transition-colors"
                  title="Cerrar"
                  aria-label="Cerrar banner"
                >
                  <XMarkIcon className="h-5 w-5 text-gray-700" />
                </button>
                <img src={bannerImage} alt="Aviso" className="w-full h-auto block" />
                <button
                  type="button"
                  onClick={handleDismissBanner}
                  className="w-full py-2.5 px-4 bg-white hover:bg-gray-100 text-gray-800 text-sm font-medium transition-colors"
                >
                  Cerrar y continuar al login
                </button>
              </div>
            </div>

            {/* Desktop (sm+): overlay sobre el card del login */}
            <div className="hidden sm:flex absolute inset-0 z-10 flex-col rounded-xl overflow-hidden shadow-2xl">
              <button
                type="button"
                onClick={handleDismissBanner}
                className="absolute top-2 right-2 z-20 bg-white rounded-full p-1.5 shadow-lg hover:bg-gray-100 transition-colors"
                title="Cerrar"
                aria-label="Cerrar banner"
              >
                <XMarkIcon className="h-5 w-5 text-gray-700" />
              </button>
              <img src={bannerImage} alt="Aviso" className="w-full flex-1 min-h-0 object-cover object-top" />
              <button
                type="button"
                onClick={handleDismissBanner}
                className="flex-shrink-0 w-full py-2.5 px-4 bg-white hover:bg-gray-100 text-gray-800 text-sm font-medium transition-colors"
              >
                Cerrar y continuar al login
              </button>
            </div>
          </>
        )}

        <div>
          <img
            src="/logo.png"
            alt="MOSAICO"
            className="mx-auto h-24 w-auto"
          />
          <p className="mt-4 text-center text-sm text-gray-600">
            Inicia sesión en tu cuenta
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Usuario o correo
              </label>
              <input
                {...register('email')}
                type="text"
                autoComplete="username"
                className="input-field"
                placeholder="usuario o tu@email.com"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-danger-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                {...register('password')}
                type="password"
                autoComplete="current-password"
                className="input-field"
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-danger-600">{errors.password.message}</p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 loading-spinner border-white"></div>
              ) : (
                'Iniciar Sesión'
              )}
            </button>
          </div>

          {/* Forgot password link */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-sm text-primary-600 hover:text-primary-800 hover:underline transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        </form>
      </div>
    </div>

    {/* Forgot password modal */}
    {showForgot && (
      <Suspense fallback={null}>
        <ForgotPasswordModal
          initialEmail={watch('email') || ''}
          onClose={() => setShowForgot(false)}
        />
      </Suspense>
    )}
    </>
  )
}