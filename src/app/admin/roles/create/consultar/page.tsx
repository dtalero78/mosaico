'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import CambiarRolTab from '@/components/admin/CambiarRolTab'
import { exportToExcel } from '@/lib/export-excel'
import {
  ArrowDownTrayIcon, EyeIcon, EyeSlashIcon, KeyIcon, PencilSquareIcon, PlusIcon, TrashIcon,
} from '@heroicons/react/24/outline'

/**
 * Gestión de Usuarios — consulta por rol de las cuentas de acceso
 * (USUARIOS_ROLES) con Editar, Clave y Eliminar por fila. Cada acción lleva su
 * permiso y el servidor repite las guardas: las cuentas ADMIN/SUPER_ADMIN no se
 * tocan desde aquí y nadie elimina su propia cuenta.
 * Gateada por MANTENIMIENTO.USUARIOS.CREAR_ROL.
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
  plataforma: string | null
}

const INTOCABLES = ['ADMIN', 'SUPER_ADMIN']
const PLATAFORMAS = ['Chile', 'Colombia', 'Ecuador', 'Perú', 'Internacional']

const nombreDe = (u: Usuario) => `${u.nombre || ''} ${u.apellido || ''}`.trim()

export default function GestionUsuariosPage() {
  const [roles, setRoles] = useState<{ rol: string; n: number }[]>([])
  const [rol, setRol] = useState('')
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [verClaves, setVerClaves] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'consultar' | 'cambiar'>('consultar')

  const { hasPermission } = usePermissions()
  const puedeCambiarRol = hasPermission(MantenimientoPermission.CAMBIAR_ROL)
  const puedeEditar = hasPermission(MantenimientoPermission.USUARIO_EDITAR)
  const puedeClave = hasPermission(MantenimientoPermission.USUARIO_CLAVE)
  const puedeEliminar = hasPermission(MantenimientoPermission.USUARIO_ELIMINAR)
  const conAcciones = puedeEditar || puedeClave || puedeEliminar

  // Modales
  const [editar, setEditar] = useState<Usuario | null>(null)
  const [form, setForm] = useState({ nombre: '', apellido: '', email: '', celular: '', plataforma: '', activo: true })
  const [clave, setClave] = useState<Usuario | null>(null)
  const [claveNueva, setClaveNueva] = useState('')
  const [claveRepetida, setClaveRepetida] = useState('')
  const [verClaveNueva, setVerClaveNueva] = useState(false)
  const [eliminar, setEliminar] = useState<Usuario | null>(null)
  const [motivo, setMotivo] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/admin/users/consulta')
      .then(r => r.json())
      .then(j => { if (j.success) setRoles(j.roles || []) })
      .catch(() => setError('No se pudieron cargar los roles'))
  }, [])

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
      nombreDe(u).toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.userLogin || '').toLowerCase().includes(q) ||
      (u.celular || '').toLowerCase().includes(q) ||
      (u.numberid || '').toLowerCase().includes(q),
    )
  }, [usuarios, busca])

  const exportar = () => {
    exportToExcel<Usuario>(
      filtrados,
      [
        { header: 'Email',      accessor: u => u.email || '' },
        { header: 'Nombre',     accessor: u => nombreDe(u) },
        { header: 'Teléfono',   accessor: u => u.celular || '' },
        { header: 'Usuario',    accessor: u => u.userLogin || '' },
        { header: 'Clave',      accessor: u => u.password || '' },
        { header: 'Rol',        accessor: u => u.rol || '' },
        { header: 'Plataforma', accessor: u => u.plataforma || '' },
        { header: 'Activo',     accessor: u => (u.activo ? 'Sí' : 'No') },
        { header: 'Documento',  accessor: u => u.numberid || '' },
        { header: 'ID',         accessor: u => u._id },
      ],
      `usuarios_${rol || 'todos'}`,
    )
  }

  const abrirEditar = (u: Usuario) => {
    setEditar(u)
    setForm({
      nombre: u.nombre || '', apellido: u.apellido || '', email: u.email || '',
      celular: u.celular || '', plataforma: u.plataforma || '', activo: u.activo !== false,
    })
  }

  const guardarEdicion = async () => {
    if (!editar) return
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    setBusy(true)
    try {
      const j = await fetch(`/api/admin/users/${encodeURIComponent(editar._id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || 'No se pudo guardar')
      setUsuarios(prev => prev.map(x => x._id === editar._id ? {
        ...x, nombre: form.nombre.trim(), apellido: form.apellido.trim() || null,
        email: form.email.trim().toLowerCase(), celular: form.celular.replace(/\D/g, '') || null,
        plataforma: form.plataforma.trim() || null, activo: form.activo,
      } : x))
      toast.success('Cuenta actualizada')
      setEditar(null)
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  const guardarClave = async () => {
    if (!clave) return
    if (claveNueva.length < 6) { toast.error('La clave debe tener al menos 6 caracteres'); return }
    if (claveNueva !== claveRepetida) { toast.error('Las claves no coinciden'); return }
    setBusy(true)
    try {
      const j = await fetch(`/api/admin/users/${encodeURIComponent(clave._id)}/clave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: claveNueva }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || 'No se pudo cambiar la clave')
      setUsuarios(prev => prev.map(x => x._id === clave._id ? { ...x, password: claveNueva } : x))
      toast.success('Clave actualizada')
      setClave(null)
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  const confirmarEliminar = async () => {
    if (!eliminar) return
    if (!motivo.trim()) { toast.error('Escribe el motivo'); return }
    setBusy(true)
    try {
      const j = await fetch(`/api/admin/users/${encodeURIComponent(eliminar._id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: motivo.trim() }),
      }).then(r => r.json())
      if (!j.success) throw new Error(j.error || 'No se pudo eliminar')
      setUsuarios(prev => prev.filter(x => x._id !== eliminar._id))
      setRoles(prev => prev.map(r => r.rol === eliminar.rol ? { ...r, n: Math.max(0, r.n - 1) } : r))
      toast.success('Cuenta eliminada')
      setEliminar(null)
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  const campo = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Gestión Usuarios — Consulta por Rol</h1>
          <p className="text-gray-500 mb-2">
            Email, nombre, teléfono, usuario y clave de las cuentas de acceso. Edita, cambia la clave o elimina cada cuenta desde la columna Acciones.
          </p>
          <Link href="/admin/roles/create"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-900 mb-5">
            <PlusIcon className="w-4 h-4" /> Crear una cuenta de acceso (estudiante, administrativo, guía o comercial)
          </Link>

          {puedeCambiarRol && (
            <div className="flex gap-1 border-b border-gray-200 mb-6">
              {([['consultar', 'Consultar'], ['cambiar', 'Cambiar rol']] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setTab(id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {tab === 'cambiar' && puedeCambiarRol ? <CambiarRolTab roles={roles} /> : (<>

          {/* Controles */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1 max-w-sm">
                <label htmlFor="gu-rol" className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                <select id="gu-rol" value={rol} onChange={e => { setRol(e.target.value); setBusca('') }} className={campo}>
                  <option value="">Selecciona un rol…</option>
                  {roles.map(r => <option key={r.rol} value={r.rol}>{r.rol} ({r.n})</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[240px]">
                <label htmlFor="gu-busca" className="block text-sm font-medium text-gray-700 mb-1">Buscar (nombre, email, usuario, teléfono)</label>
                <input id="gu-busca" value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Escribe para filtrar…" disabled={!rol} className={`${campo} disabled:bg-gray-50`} />
              </div>
              <button type="button" onClick={() => setVerClaves(v => !v)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200">
                {verClaves ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                {verClaves ? 'Ocultar claves' : 'Mostrar claves'}
              </button>
              <button type="button" onClick={exportar} disabled={filtrados.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400">
                <ArrowDownTrayIcon className="w-4 h-4" /> Exportar CSV
              </button>
            </div>
          </div>

          {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

          {!rol ? (
            <div className="text-center text-gray-400 py-16">Selecciona un rol para ver sus usuarios.</div>
          ) : loading ? (
            <div className="text-center text-gray-500 py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto mb-2" />
              Cargando…
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 text-sm text-gray-500">
                {filtrados.length} usuario(s)
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      {['Email', 'Nombre', 'Teléfono', 'Usuario', 'Clave', 'Rol', 'Plataforma', 'Activo', ...(conAcciones ? ['Acciones'] : [])]
                        .map(h => <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtrados.length === 0 ? (
                      <tr><td colSpan={conAcciones ? 9 : 8} className="px-4 py-8 text-center text-gray-400">Sin resultados.</td></tr>
                    ) : filtrados.map(u => {
                      const intocable = INTOCABLES.includes(String(u.rol || '').toUpperCase())
                      const titulo = intocable ? 'Las cuentas ADMIN y SUPER_ADMIN no se modifican desde aquí' : undefined
                      return (
                        <tr key={u._id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-800 whitespace-nowrap">{u.email || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-gray-800 min-w-[220px]">{nombreDe(u) || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{u.celular || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-gray-800 font-mono text-xs whitespace-nowrap">{u.userLogin || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                            {u.password
                              ? (verClaves ? <span className="text-gray-800">{u.password}</span> : <span className="text-gray-500 select-none">••••••••</span>)
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-primary-50 text-primary-700">{u.rol}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{u.plataforma || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${u.activo ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                              {u.activo ? 'Sí' : 'No'}
                            </span>
                          </td>
                          {conAcciones && (
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <div className="flex gap-1.5">
                                {puedeEditar && (
                                  <button type="button" onClick={() => abrirEditar(u)} disabled={intocable} title={titulo}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                    <PencilSquareIcon className="w-3.5 h-3.5" /> Editar
                                  </button>
                                )}
                                {puedeClave && (
                                  <button type="button" disabled={intocable} title={titulo}
                                    onClick={() => { setClave(u); setClaveNueva(''); setClaveRepetida(''); setVerClaveNueva(false) }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                    <KeyIcon className="w-3.5 h-3.5" /> Clave
                                  </button>
                                )}
                                {puedeEliminar && (
                                  <button type="button" disabled={intocable} title={titulo}
                                    onClick={() => { setEliminar(u); setMotivo(''); setConfirmo(false) }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                    <TrashIcon className="w-3.5 h-3.5" /> Eliminar
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>)}
        </div>

        {/* Editar */}
        {editar && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900">Editar cuenta</h3>
              <p className="text-sm text-gray-500 mb-4">{editar.rol}{editar.userLogin ? ` · usuario ${editar.userLogin}` : ''}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ed-nombre" className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                  <input id="ed-nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className={campo} />
                </div>
                <div>
                  <label htmlFor="ed-apellido" className="block text-xs font-medium text-gray-600 mb-1">Apellido</label>
                  <input id="ed-apellido" value={form.apellido} onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} className={campo} />
                </div>
                <div className="col-span-2">
                  <label htmlFor="ed-email" className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input id="ed-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={campo} />
                  {editar.rol === 'GUIA' && <p className="text-xs text-gray-500 mt-1">Es la cuenta de un guía: el email se cambia también en su ficha.</p>}
                </div>
                <div>
                  <label htmlFor="ed-cel" className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input id="ed-cel" value={form.celular} onChange={e => setForm(f => ({ ...f, celular: e.target.value.replace(/\D/g, '') }))}
                    placeholder="Sólo números, con indicativo" className={campo} />
                </div>
                <div>
                  <label htmlFor="ed-plat" className="block text-xs font-medium text-gray-600 mb-1">Plataforma</label>
                  <select id="ed-plat" value={form.plataforma} onChange={e => setForm(f => ({ ...f, plataforma: e.target.value }))} className={campo}>
                    <option value="">—</option>
                    {[...PLATAFORMAS, ...(form.plataforma && !PLATAFORMAS.includes(form.plataforma) ? [form.plataforma] : [])]
                      .map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <label className="col-span-2 inline-flex items-center gap-2 text-sm text-gray-700 mt-1">
                  <input type="checkbox" checked={form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                  Cuenta activa (si se desmarca, no puede entrar)
                </label>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" onClick={() => setEditar(null)} disabled={busy}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={guardarEdicion} disabled={busy}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clave */}
        {clave && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900">Cambiar clave</h3>
              <p className="text-sm text-gray-500 mb-4">{nombreDe(clave) || clave.email} · {clave.rol}</p>
              <label htmlFor="cl-nueva" className="block text-xs font-medium text-gray-600 mb-1">Clave nueva</label>
              <div className="relative mb-3">
                <input id="cl-nueva" type={verClaveNueva ? 'text' : 'password'} value={claveNueva}
                  onChange={e => setClaveNueva(e.target.value.replace(/\s/g, ''))} className={`${campo} pr-10`} />
                <button type="button" onClick={() => setVerClaveNueva(v => !v)} aria-label={verClaveNueva ? 'Ocultar clave' : 'Mostrar clave'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {verClaveNueva ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
              <label htmlFor="cl-rep" className="block text-xs font-medium text-gray-600 mb-1">Repite la clave</label>
              <input id="cl-rep" type={verClaveNueva ? 'text' : 'password'} value={claveRepetida}
                onChange={e => setClaveRepetida(e.target.value.replace(/\s/g, ''))} className={campo} />
              <p className="text-xs text-gray-500 mt-2">
                Entre 6 y 40 caracteres, sin espacios.
                {clave.rol === 'ESTUDIANTE' && ' También se actualiza en su registro académico.'}
                {clave.rol === 'GUIA' && ' También se actualiza en su ficha de guía.'}
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" onClick={() => setClave(null)} disabled={busy}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={guardarClave} disabled={busy || !claveNueva || claveNueva !== claveRepetida}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                  {busy ? 'Guardando…' : 'Cambiar clave'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Eliminar */}
        {eliminar && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900">Eliminar cuenta de acceso</h3>
              <p className="text-sm text-gray-700 mt-1">
                <strong>{nombreDe(eliminar) || eliminar.email}</strong> · {eliminar.rol}
              </p>
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800 mt-3">
                La persona dejará de poder entrar a la plataforma. Su ficha y su historial no se borran, y queda una copia de la cuenta en la bitácora. Desde aquí no se puede deshacer.
              </div>
              <label htmlFor="el-motivo" className="block text-xs font-medium text-gray-600 mt-4 mb-1">Motivo *</label>
              <textarea id="el-motivo" rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} className={campo} />
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 mt-3">
                <input type="checkbox" checked={confirmo} onChange={e => setConfirmo(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600" />
                Confirmo que quiero eliminar esta cuenta
              </label>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" onClick={() => setEliminar(null)} disabled={busy}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={confirmarEliminar} disabled={busy || !confirmo || !motivo.trim()}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                  {busy ? 'Eliminando…' : 'Eliminar cuenta'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
