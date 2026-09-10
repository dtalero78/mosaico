'use client'

import { useEffect, useMemo, useState } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

/**
 * Pestaña "Cambiar rol" de /admin/roles/create/consultar.
 *
 * Cambiar el rol de una cuenta cambia lo que esa persona ve y puede hacer en
 * toda la plataforma, así que el flujo obliga a mirar antes de actuar: se elige
 * a la persona de una lista, se ve su rol actual, se escribe el motivo y recién
 * ahí se habilita el botón.
 *
 * Las guardas de verdad están en el SERVIDOR (no se puede cambiar el rol de uno
 * mismo, ni asignar o tocar ADMIN y SUPER_ADMIN). Aquí sólo se reflejan: los
 * roles de administración ni se ofrecen ni se listan como origen, para no
 * invitar a intentar algo que el endpoint va a rechazar.
 */

/** Se refleja lo que el servidor prohíbe; la decisión vive allá. */
const ROLES_INTOCABLES = ['SUPER_ADMIN', 'ADMIN']

interface Usuario {
  _id: string
  email: string | null
  userLogin: string | null
  nombre: string | null
  apellido: string | null
  rol: string
  activo: boolean | null
}

export default function CambiarRolTab({ roles }: { roles: { rol: string; n: number }[] }) {
  const [rolOrigen, setRolOrigen] = useState('')
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [busca, setBusca] = useState('')
  const [elegido, setElegido] = useState<Usuario | null>(null)
  const [rolNuevo, setRolNuevo] = useState('')
  const [motivo, setMotivo] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // Roles asignables: los del catálogo menos los de administración.
  const asignables = useMemo(
    () => roles.filter(r => !ROLES_INTOCABLES.includes(r.rol.toUpperCase())),
    [roles]
  )

  useEffect(() => {
    if (!rolOrigen) { setUsuarios([]); return }
    setLoading(true); setError(null); setElegido(null)
    fetch(`/api/admin/users/consulta?rol=${encodeURIComponent(rolOrigen)}`)
      .then(r => r.json())
      .then(j => { if (j.success) setUsuarios(j.usuarios || []); else setError(j.error || 'Error') })
      .catch(() => setError('No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false))
  }, [rolOrigen])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return usuarios
    return usuarios.filter(u =>
      [u.nombre, u.apellido, u.email, u.userLogin].filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q)))
  }, [usuarios, busca])

  const nombreDe = (u: Usuario) =>
    [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email || u.userLogin || u._id

  const puedeGuardar = !!elegido && !!rolNuevo && motivo.trim().length > 0 && confirmar && !guardando

  const guardar = async () => {
    if (!puedeGuardar || !elegido) return
    setGuardando(true); setError(null); setOk(null)
    try {
      const res = await fetch('/api/admin/users/cambiar-rol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuarioRolId: elegido._id, rolNuevo, motivo: motivo.trim() }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j?.error || 'No se pudo cambiar el rol'); return }
      setOk(j.message || 'Rol cambiado')
      // La cuenta ya no está en el rol de origen: se saca de la lista.
      setUsuarios(prev => prev.filter(u => u._id !== elegido._id))
      setElegido(null); setRolNuevo(''); setMotivo(''); setConfirmar(false)
    } catch {
      setError('No se pudo cambiar el rol')
    } finally { setGuardando(false) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Cambiar el rol cambia lo que esa persona ve y puede hacer en toda la plataforma.
        Queda registrado quién lo hizo y por qué. <strong>ADMIN y SUPER_ADMIN no se asignan
        desde aquí</strong> — eso se gestiona en Permisos.
      </div>

      {/* Paso 1: de qué rol viene */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rol actual del usuario</label>
          <select value={rolOrigen} onChange={e => { setRolOrigen(e.target.value); setBusca('') }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px] focus:ring-2 focus:ring-primary-500">
            <option value="">Selecciona un rol…</option>
            {asignables.map(r => <option key={r.rol} value={r.rol}>{r.rol} ({r.n})</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={busca} onChange={e => setBusca(e.target.value)} disabled={!rolOrigen}
              placeholder="Nombre, email o usuario…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50" />
          </div>
        </div>
      </div>

      {ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{ok}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Paso 2: a quién */}
      {!rolOrigen ? (
        <div className="text-center text-gray-400 py-12">Elige el rol que tiene hoy la persona.</div>
      ) : loading ? (
        <div className="text-center text-gray-400 py-12">Cargando…</div>
      ) : filtrados.length === 0 ? (
        <div className="text-center text-gray-400 py-12">Sin usuarios con ese rol.</div>
      ) : (
        <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
          {filtrados.map(u => (
            <label key={u._id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 ${elegido?._id === u._id ? 'bg-primary-50' : ''}`}>
              <input type="radio" name="usuario" className="h-4 w-4"
                checked={elegido?._id === u._id} onChange={() => { setElegido(u); setOk(null) }} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-gray-900 truncate">{nombreDe(u)}</span>
                <span className="block text-xs text-gray-500 truncate">{u.email || '—'} · {u.userLogin || '—'}</span>
              </span>
              {u.activo === false && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">inactivo</span>
              )}
            </label>
          ))}
        </div>
      )}

      {/* Paso 3: a qué rol, por qué, y confirmar */}
      {elegido && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <p className="text-sm text-gray-700">
            <strong>{nombreDe(elegido)}</strong> pasaría de{' '}
            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">{elegido.rol}</span>
            {' '}a{' '}
            <span className="px-2 py-0.5 rounded bg-primary-100 text-primary-800 text-xs font-medium">{rolNuevo || '…'}</span>
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol nuevo</label>
            <select value={rolNuevo} onChange={e => setRolNuevo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px] focus:ring-2 focus:ring-primary-500">
              <option value="">Selecciona el rol nuevo…</option>
              {asignables.filter(r => r.rol !== elegido.rol).map(r => (
                <option key={r.rol} value={r.rol}>{r.rol}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Motivo *</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
              placeholder="Por qué se cambia el rol de esta persona…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="h-4 w-4 mt-0.5" checked={confirmar}
              onChange={e => setConfirmar(e.target.checked)} />
            <span>
              Confirmo el cambio de rol de <strong>{nombreDe(elegido)}</strong>.
              Si tiene la sesión abierta, le aplicará cuando vuelva a entrar.
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={() => { setElegido(null); setRolNuevo(''); setMotivo(''); setConfirmar(false) }}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={!puedeGuardar}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-primary-600 hover:bg-primary-700 disabled:bg-gray-200 disabled:text-gray-400">
              {guardando ? 'Cambiando…' : 'Cambiar rol'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
