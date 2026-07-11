'use client'

import { useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { ArrowLeftIcon, CheckCircleIcon, ClipboardIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const PLATAFORMAS = ['Chile', 'Colombia', 'Ecuador', 'Perú']
const ROLES = [
  { value: 'COMERCIAL', label: 'Comercial' },
  { value: 'COMERCIAL_JEFE', label: 'Comercial Jefe' },
]

interface Filial { _id: string; nombre: string }

export default function CrearComercialPage() {
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [plataforma, setPlataforma] = useState('')
  const [filial, setFilial] = useState('')
  const [rol, setRol] = useState('COMERCIAL')
  const [filiales, setFiliales] = useState<Filial[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ nombre: string; correo: string; clave: string } | null>(null)

  // Filiales de la plataforma seleccionada
  useEffect(() => {
    if (!plataforma) { setFiliales([]); setFilial(''); return }
    setFilial('')
    fetch(`/api/admin/filiales?plataforma=${encodeURIComponent(plataforma)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setFiliales(d.filiales || []))
      .catch(() => setFiliales([]))
  }, [plataforma])

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())
  const canSubmit = nombre.trim() && emailOk && plataforma && rol && !busy

  const submit = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/equipo-comercial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim(), correo: correo.trim(), plataforma, filial, rol }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || j?.message || 'Error al crear')
      setResult({ nombre: nombre.trim(), correo: correo.trim(), clave: j.clave })
      toast.success('Comercial creado')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setResult(null); setNombre(''); setCorreo(''); setPlataforma(''); setFilial(''); setRol('COMERCIAL')
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-lg mx-auto">
          <button type="button" onClick={() => history.back()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeftIcon className="w-4 h-4" /> Volver
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Crear Comercial</h1>
          <p className="text-gray-500 mb-6">Se crea en el equipo comercial y su login (por correo, clave automática).</p>

          {result ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
              <CheckCircleIcon className="w-10 h-10 text-emerald-600 mb-3" />
              <h2 className="text-lg font-semibold text-emerald-800">Comercial creado</h2>
              <p className="text-sm text-emerald-700 mt-1">{result.nombre} · {result.correo}</p>
              <div className="mt-4 p-3 bg-white rounded-lg border border-emerald-200">
                <div className="text-xs text-gray-500 mb-1">Clave generada (compártela, no se vuelve a mostrar)</div>
                <div className="flex items-center gap-2">
                  <code className="text-lg font-mono font-bold text-gray-900">{result.clave}</code>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(result.clave); toast.success('Clave copiada') }}
                    className="p-1.5 text-gray-400 hover:text-gray-600" title="Copiar">
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button type="button" onClick={reset}
                className="mt-5 px-4 py-2 bg-fuchsia-600 text-white text-sm rounded-lg hover:bg-fuchsia-700">
                Crear otro
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
                <input value={nombre} onChange={e => setNombre(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Correo * (será su usuario de login)</label>
                <input value={correo} onChange={e => setCorreo(e.target.value)} type="email"
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${correo && !emailOk ? 'border-red-400' : 'border-gray-300'}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Plataforma *</label>
                  <select value={plataforma} onChange={e => setPlataforma(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="">— Selecciona —</option>
                    {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Rol *</label>
                  <select value={rol} onChange={e => setRol(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Filial</label>
                <select value={filial} onChange={e => setFilial(e.target.value)} disabled={!plataforma}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
                  <option value="">{plataforma ? '— (opcional) —' : 'Selecciona plataforma primero'}</option>
                  {filiales.map(f => <option key={f._id} value={f.nombre}>{f.nombre}</option>)}
                </select>
                <a href="/admin/roles/create/filiales" target="_blank" rel="noopener noreferrer"
                  className="text-xs text-fuchsia-600 hover:text-fuchsia-800 mt-1 inline-block">Gestionar filiales ↗</a>
              </div>
              <button type="button" onClick={submit} disabled={!canSubmit}
                className="w-full py-2.5 bg-fuchsia-600 text-white font-medium rounded-lg hover:bg-fuchsia-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? 'Creando…' : 'Crear Comercial'}
              </button>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
