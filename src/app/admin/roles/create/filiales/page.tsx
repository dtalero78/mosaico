'use client'

import { useEffect, useState, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const PLATAFORMAS = ['Chile', 'Colombia', 'Ecuador', 'Perú']

interface Filial { _id: string; plataforma: string; nombre: string; activo: boolean }

export default function GestionFilialesPage() {
  const [filiales, setFiliales] = useState<Filial[]>([])
  const [loading, setLoading] = useState(true)
  const [nuevaPlat, setNuevaPlat] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/filiales?includeInactive=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setFiliales(d.filiales || []))
      .catch(() => toast.error('Error al cargar filiales'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const agregar = async () => {
    if (!nuevaPlat || !nuevoNombre.trim()) { toast.error('Plataforma y nombre son obligatorios'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/admin/filiales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plataforma: nuevaPlat, nombre: nuevoNombre.trim() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Error al agregar')
      setNuevoNombre('')
      toast.success('Filial agregada')
      load()
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  const toggle = async (f: Filial) => {
    try {
      const r = await fetch(`/api/admin/filiales/${f._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !f.activo }),
      })
      if (!r.ok) throw new Error((await r.json())?.error || 'Error')
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const borrar = async (f: Filial) => {
    if (!confirm(`¿Borrar la filial "${f.nombre}" (${f.plataforma})?`)) return
    try {
      const r = await fetch(`/api/admin/filiales/${f._id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Error al borrar')
      toast.success('Filial borrada')
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const porPlataforma = PLATAFORMAS
    .map(p => ({ plataforma: p, items: filiales.filter(f => f.plataforma.toLowerCase() === p.toLowerCase()) }))
    .filter(g => g.items.length > 0)

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-2xl mx-auto">
          <button type="button" onClick={() => history.back()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeftIcon className="w-4 h-4" /> Volver
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Filiales</h1>
          <p className="text-gray-500 mb-6">Catálogo de filiales por plataforma para el alta de comerciales.</p>

          {/* Agregar */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Plataforma</label>
              <select value={nuevaPlat} onChange={e => setNuevaPlat(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[140px]">
                <option value="">— Selecciona —</option>
                {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nombre de la filial</label>
              <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') agregar() }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <button type="button" onClick={agregar} disabled={busy}
              className="px-4 py-2 bg-fuchsia-600 text-white text-sm rounded-lg hover:bg-fuchsia-700 disabled:opacity-40 flex items-center gap-1">
              <PlusIcon className="w-4 h-4" /> Agregar
            </button>
          </div>

          {/* Lista */}
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Cargando…</p>
          ) : porPlataforma.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No hay filiales. Agrega la primera arriba.</p>
          ) : (
            <div className="space-y-5">
              {porPlataforma.map(g => (
                <div key={g.plataforma}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">{g.plataforma}</h3>
                  <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                    {g.items.map(f => (
                      <div key={f._id} className="flex items-center justify-between px-4 py-2.5">
                        <span className={`text-sm ${f.activo ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{f.nombre}</span>
                        <div className="flex items-center gap-3">
                          <button type="button" onClick={() => toggle(f)}
                            className={`text-xs px-2 py-1 rounded-md ${f.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {f.activo ? 'Activa' : 'Inactiva'}
                          </button>
                          <button type="button" onClick={() => borrar(f)}
                            className="text-gray-400 hover:text-red-600" title="Borrar">
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
