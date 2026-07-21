'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { ArrowLeftIcon, EyeIcon, EyeSlashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'

/**
 * Consulta de usuarios (cuentas de login) por rol — muestra email, nombre, id,
 * usuario (userLogin) y clave (password). Lee de USUARIOS_ROLES vía
 * /api/admin/users/consulta. Gateada por MANTENIMIENTO.USUARIOS.CREAR_ROL.
 */

interface Usuario {
  _id: string
  email: string | null
  userLogin: string | null
  nombre: string | null
  apellido: string | null
  password: string | null
  celular: string | null
  numberid: string | null
  rol: string
  activo: boolean | null
}

export default function ConsultarUsuariosPage() {
  const router = useRouter()
  const [roles, setRoles] = useState<{ rol: string; n: number }[]>([])
  const [rol, setRol] = useState('')
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [verClaves, setVerClaves] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cargar la lista de roles (con conteo) al montar.
  useEffect(() => {
    fetch('/api/admin/users/consulta')
      .then(r => r.json())
      .then(j => { if (j.success) setRoles(j.roles || []) })
      .catch(() => setError('No se pudieron cargar los roles'))
  }, [])

  // Cargar usuarios al elegir un rol.
  useEffect(() => {
    if (!rol) { setUsuarios([]); return }
    setLoading(true); setError(null)
    fetch(`/api/admin/users/consulta?rol=${encodeURIComponent(rol)}`)
      .then(r => r.json())
      .then(j => { if (j.success) setUsuarios(j.usuarios || []); else setError(j.error || 'Error') })
      .catch(() => setError('No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false))
  }, [rol])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return usuarios
    return usuarios.filter(u =>
      `${u.nombre || ''} ${u.apellido || ''}`.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.userLogin || '').toLowerCase().includes(q) ||
      (u.numberid || '').toLowerCase().includes(q),
    )
  }, [usuarios, busca])

  const exportar = () => {
    exportToExcel<Usuario>(
      filtrados,
      [
        { header: 'Email',     accessor: u => u.email || '' },
        { header: 'Nombre',    accessor: u => `${u.nombre || ''} ${u.apellido || ''}`.trim() },
        { header: 'ID',        accessor: u => u._id },
        { header: 'Usuario',   accessor: u => u.userLogin || '' },
        { header: 'Clave',     accessor: u => u.password || '' },
        { header: 'Teléfono',  accessor: u => u.celular || '' },
        { header: 'Documento', accessor: u => u.numberid || '' },
        { header: 'Activo',    accessor: u => (u.activo ? 'Sí' : 'No') },
      ],
      `usuarios_${rol || 'todos'}`,
    )
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <button type="button" onClick={() => router.push('/admin/roles/create')}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeftIcon className="w-4 h-4" /> Crear Usuarios
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Consultar usuarios por rol</h1>
          <p className="text-gray-500 mb-6">Email, nombre, ID, usuario y clave de las cuentas de login.</p>

          {/* Controles */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
              <select
                value={rol}
                onChange={e => { setRol(e.target.value); setBusca('') }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px] focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Selecciona un rol…</option>
                {roles.map(r => (
                  <option key={r.rol} value={r.rol}>{r.rol} ({r.n})</option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Nombre, email, usuario o documento…"
                  disabled={!rol}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            <button type="button" onClick={() => setVerClaves(v => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
              {verClaves ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              {verClaves ? 'Ocultar claves' : 'Mostrar claves'}
            </button>

            <button type="button" onClick={exportar} disabled={filtrados.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400">
              Exportar CSV
            </button>
          </div>

          {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

          {/* Tabla */}
          {!rol ? (
            <div className="text-center text-gray-400 py-16">Selecciona un rol para ver sus usuarios.</div>
          ) : loading ? (
            <div className="text-center text-gray-500 py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto mb-2" />
              Cargando…
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-100 text-sm text-gray-500">
                {filtrados.length} usuario{filtrados.length === 1 ? '' : 's'} · rol <span className="font-medium text-gray-700">{rol}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Email</th>
                      <th className="px-4 py-2 text-left font-medium">Nombre</th>
                      <th className="px-4 py-2 text-left font-medium">ID</th>
                      <th className="px-4 py-2 text-left font-medium">Usuario</th>
                      <th className="px-4 py-2 text-left font-medium">Clave</th>
                      <th className="px-4 py-2 text-left font-medium">Teléfono</th>
                      <th className="px-4 py-2 text-left font-medium">Activo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtrados.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin resultados.</td></tr>
                    ) : filtrados.map(u => (
                      <tr key={u._id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-800">{u.email || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2 text-gray-800">{`${u.nombre || ''} ${u.apellido || ''}`.trim() || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2 text-gray-400 font-mono text-xs">{u._id}</td>
                        <td className="px-4 py-2 text-gray-800 font-mono text-xs">{u.userLogin || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {u.password
                            ? (verClaves ? <span className="text-gray-800">{u.password}</span> : <span className="text-gray-400 select-none">••••••••</span>)
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2 text-gray-800">{u.celular || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {u.activo ? 'Sí' : 'No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
