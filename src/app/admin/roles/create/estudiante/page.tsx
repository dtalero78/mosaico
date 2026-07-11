'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import {
  UserPlusIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

/**
 * "Crea UserRol" — genera una cuenta de login en USUARIOS_ROLES a partir de
 * un estudiante existente en ACADEMICA.
 *
 * Flujo:
 *   1. Admin ingresa numeroId + busca
 *   2. Backend valida (existe en ACADEMICA, email presente, no duplica USUARIOS_ROLES)
 *   3. Se muestra preview con datos detectados
 *   4. Si ACADEMICA.clave existe → se usa esa. Si no, admin ingresa una.
 *   5. Click "Crear cuenta" → INSERT en USUARIOS_ROLES con rol ESTUDIANTE
 *   6. Card de éxito con resumen
 */

interface AcademicaPreview {
  _id: string
  numeroId: string
  nombre: string
  apellido: string
  email: string | null
  celular: string | null
  contrato: string | null
  plataforma: string | null
  tipoUsuario: string | null
  nivel: string | null
  step: string | null
  estadoInactivo: boolean | null
}

interface Issue {
  code: string
  message: string
}

interface PreviewResponse {
  academica: AcademicaPreview
  canCreate: boolean
  issues: Issue[]
  existingUser: { _id: string; nombre: string; rol: string; activo: boolean | null } | null
  passwordFromAcademica: boolean
}

interface CreatedUser {
  _id: string
  email: string
  nombre: string
  apellido: string | null
  rol: string
  numberid: string | null
  contrato: string | null
  plataforma: string | null
}

export default function CrearUserRolPage() {
  const [numeroId, setNumeroId] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)

  const [created, setCreated] = useState<{ user: CreatedUser; passwordSource: 'academica' | 'admin'; academicaId: string } | null>(null)

  const handleSearch = async () => {
    const id = numeroId.trim()
    if (!id) return
    setLoading(true); setError(null); setPreview(null); setPassword(''); setCreated(null)
    try {
      const res = await fetch(`/api/admin/users/create-from-academica?numeroId=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Error ${res.status}`)
      }
      setPreview(data as PreviewResponse)
    } catch (e: any) {
      setError(e?.message || 'Error al buscar')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!preview) return
    if (!preview.canCreate) return
    setCreating(true); setError(null)
    try {
      const body: Record<string, string> = { numeroId: preview.academica.numeroId }
      // Sólo enviamos password si ACADEMICA no la tiene (caso en que el admin la digitó).
      if (!preview.passwordFromAcademica) {
        if (!password || password.length < 4) {
          throw new Error('La contraseña debe tener al menos 4 caracteres')
        }
        body.password = password
      }
      const res = await fetch('/api/admin/users/create-from-academica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Error ${res.status}`)
      }
      toast.success(`Cuenta creada para ${data.user.nombre}`)
      setCreated({ user: data.user, passwordSource: data.passwordSource, academicaId: data.academicaId })
    } catch (e: any) {
      setError(e?.message || 'Error al crear cuenta')
    } finally {
      setCreating(false)
    }
  }

  const handleReset = () => {
    setNumeroId('')
    setPreview(null)
    setPassword('')
    setError(null)
    setCreated(null)
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL}>
        <div className="max-w-3xl mx-auto py-8 space-y-4">
          {/* Header */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-full flex-shrink-0">
                <UserPlusIcon className="h-7 w-7 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Crea UserRol</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  Genera una cuenta de login en <code className="text-xs bg-gray-100 px-1 rounded">USUARIOS_ROLES</code> a partir
                  de un estudiante existente en <code className="text-xs bg-gray-100 px-1 rounded">ACADEMICA</code>.
                  El rol siempre será <strong>ESTUDIANTE</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* Buscador */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <label htmlFor="numero-id" className="block text-sm font-medium text-gray-700 mb-2">
              Número de Documento del estudiante
            </label>
            <div className="flex gap-2">
              <input
                id="numero-id"
                type="text"
                value={numeroId}
                onChange={e => setNumeroId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
                placeholder="Ej: 0703697813 o 18201897-K"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={loading || creating}
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={!numeroId.trim() || loading || creating}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
                {loading ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            {!preview && !error && !created && (
              <p className="text-xs text-gray-400 mt-2">
                Solo letras, números y guion. Se busca en <code className="bg-gray-100 px-1 rounded">ACADEMICA.numeroId</code>.
              </p>
            )}
          </div>

          {/* Error */}
          {error && !created && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
              <XCircleIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Resultado: éxito final */}
          {created && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircleIcon className="h-7 w-7 text-emerald-600 flex-shrink-0" />
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-emerald-900">Cuenta creada exitosamente</h2>
                  <p className="text-sm text-emerald-800 mt-0.5">
                    El estudiante ya puede iniciar sesión con su email y contraseña.
                  </p>
                </div>
              </div>
              <div className="bg-white border border-emerald-200 rounded-lg p-4 text-sm space-y-2">
                <div className="grid grid-cols-3 gap-2"><span className="text-gray-500">Email</span><span className="col-span-2 font-medium font-mono text-gray-900">{created.user.email}</span></div>
                <div className="grid grid-cols-3 gap-2"><span className="text-gray-500">Nombre</span><span className="col-span-2 font-medium text-gray-900">{created.user.nombre}{created.user.apellido ? ` ${created.user.apellido}` : ''}</span></div>
                <div className="grid grid-cols-3 gap-2"><span className="text-gray-500">Rol</span><span className="col-span-2 font-medium text-gray-900">{created.user.rol}</span></div>
                <div className="grid grid-cols-3 gap-2"><span className="text-gray-500">Contrato</span><span className="col-span-2 font-medium text-gray-900">{created.user.contrato || '—'}</span></div>
                <div className="grid grid-cols-3 gap-2"><span className="text-gray-500">Plataforma</span><span className="col-span-2 font-medium text-gray-900">{created.user.plataforma || '—'}</span></div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-100"><span className="text-gray-500">Fuente clave</span><span className="col-span-2 font-medium text-gray-900">{created.passwordSource === 'academica' ? 'ACADEMICA.clave existente' : 'Ingresada por el admin'}</span></div>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/student/${created.academicaId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700"
                >
                  Ver perfil del estudiante →
                </a>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50"
                >
                  Crear otra cuenta
                </button>
              </div>
            </div>
          )}

          {/* Preview cuando se busca con éxito */}
          {preview && !created && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-semibold text-gray-900">Encontrado en ACADEMICA</h2>
                {preview.academica.tipoUsuario && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                    {preview.academica.tipoUsuario}
                  </span>
                )}
                {preview.academica.estadoInactivo === true && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                    INACTIVO
                  </span>
                )}
              </div>

              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><span className="text-gray-500">Nombre:</span> <span className="font-medium text-gray-900">{preview.academica.nombre || <em className="text-red-600">vacío</em>}</span></div>
                <div><span className="text-gray-500">Apellido:</span> <span className="font-medium text-gray-900">{preview.academica.apellido || '—'}</span></div>
                <div className="col-span-2"><span className="text-gray-500">Email:</span> <span className="font-medium font-mono text-gray-900">{preview.academica.email || <em className="text-red-600">vacío</em>}</span></div>
                <div><span className="text-gray-500">Celular:</span> <span className="font-medium text-gray-900">{preview.academica.celular || '—'}</span></div>
                <div><span className="text-gray-500">Plataforma:</span> <span className="font-medium text-gray-900">{preview.academica.plataforma || '—'}</span></div>
                <div><span className="text-gray-500">Contrato:</span> <span className="font-medium text-gray-900">{preview.academica.contrato || '—'}</span></div>
                <div><span className="text-gray-500">Nivel · Step:</span> <span className="font-medium text-gray-900">{preview.academica.nivel || '—'}{preview.academica.step ? ` · ${preview.academica.step}` : ''}</span></div>
              </div>

              {/* Validaciones */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">Validaciones</p>

                {preview.issues.map(issue => (
                  <div key={issue.code} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                    <XCircleIcon className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{issue.message}</p>
                  </div>
                ))}

                {preview.canCreate && (
                  <>
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <CheckCircleIcon className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                      <p className="text-sm text-emerald-800">Email presente y único en USUARIOS_ROLES — listo para crear.</p>
                    </div>
                    {preview.passwordFromAcademica ? (
                      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <CheckCircleIcon className="h-5 w-5 text-blue-600 flex-shrink-0" />
                        <p className="text-sm text-blue-800">Se usará la contraseña existente en <code>ACADEMICA.clave</code>.</p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800"><code>ACADEMICA.clave</code> está vacía. Ingresa una contraseña temporal abajo.</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Password input — solo si ACADEMICA.clave no existe */}
              {preview.canCreate && !preview.passwordFromAcademica && (
                <div>
                  <label htmlFor="password-input" className="block text-sm font-medium text-gray-700 mb-1">
                    Contraseña temporal <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 4 caracteres"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                      disabled={creating}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      title={showPassword ? 'Ocultar' : 'Mostrar'}
                    >
                      {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">El estudiante podrá cambiarla en su primer ingreso.</p>
                </div>
              )}

              {/* Acciones */}
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={
                    !preview.canCreate ||
                    creating ||
                    (!preview.passwordFromAcademica && password.length < 4)
                  }
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? 'Creando…' : '✓ Crear cuenta'}
                </button>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
