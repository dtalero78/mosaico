'use client'

/**
 * Libro de Producción › Planes: catálogo de planes y tipos de plan POR PAÍS.
 * Cada plan (número de cuotas, p. ej. 13) puede tener varios tipos (13-A, 13-B…) con
 * sus montos de referencia. Más adelante el tipo se elegirá en Crear Contrato.
 * Un tipo en uso no se borra: se desactiva. Gate: APROBACION.LIBRO_PRODUCCION.PLANES.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { PlusIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { api, handleApiError } from '@/hooks/use-api'

interface TipoPlan {
  _id: string; pais: string; cuotas: number; nombre: string
  inscripcion: number | null; valorCuota: number | null; total: number | null
  descripcion: string | null; activo: boolean; contratos: number
}
type Form = { cuotas: string; nombre: string; inscripcion: string; valorCuota: string; total: string; descripcion: string; activo: boolean }

const PAISES = ['Chile', 'Colombia', 'Ecuador', 'Perú']
const VACIO: Form = { cuotas: '', nombre: '', inscripcion: '', valorCuota: '', total: '', descripcion: '', activo: true }
const fmtM = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`)
const aForm = (t: TipoPlan): Form => ({
  cuotas: String(t.cuotas), nombre: t.nombre, inscripcion: t.inscripcion?.toString() ?? '',
  valorCuota: t.valorCuota?.toString() ?? '', total: t.total?.toString() ?? '', descripcion: t.descripcion || '', activo: t.activo,
})

export default function PlanesTiposPanel() {
  const [pais, setPais] = useState('Chile')
  const [planes, setPlanes] = useState<TipoPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState<string | null>(null) // null = cerrado, '' = nuevo
  const [form, setForm] = useState<Form>(VACIO)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ planes: TipoPlan[] }>(`/api/postgres/libro-produccion/planes?pais=${encodeURIComponent(pais)}`)
      setPlanes(d.planes || [])
    } catch (e) {
      handleApiError(e, 'No se pudieron cargar los planes')
    } finally {
      setLoading(false)
    }
  }, [pais])
  useEffect(() => { cargar(); setEditando(null) }, [cargar])

  const abrir = (t?: TipoPlan, cuotas?: number) => {
    setEditando(t ? t._id : '')
    setForm(t ? aForm(t) : { ...VACIO, cuotas: cuotas ? String(cuotas) : '' })
  }

  const enviar = async (datos: Form, id: string | null) => {
    setGuardando(true)
    try {
      const res = await fetch(id ? `/api/postgres/libro-produccion/planes/${id}` : '/api/postgres/libro-produccion/planes', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...datos, pais, cuotas: Number(datos.cuotas) }),
      })
      const j = await res.json()
      if (!res.ok || !j?.success) throw new Error(j?.details || j?.error || `Error ${res.status}`)
      toast.success('Guardado')
      setEditando(null)
      cargar()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const grupos = useMemo(() => {
    const m = new Map<number, TipoPlan[]>()
    for (const t of planes) { if (!m.has(t.cuotas)) m.set(t.cuotas, []); m.get(t.cuotas)!.push(t) }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0])
  }, [planes])

  const campo = (k: keyof Form, label: string, type = 'text', cls = '') => (
    <label className={`text-xs text-gray-600 ${cls}`}>
      <span className="block mb-0.5">{label}</span>
      <input type={type} value={String(form[k])} onChange={e => setForm(s => ({ ...s, [k]: e.target.value }))}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
    </label>
  )

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {PAISES.map(p => (
            <button key={p} type="button" onClick={() => setPais(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border ${pais === p ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              {p}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => abrir()}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700">
          <PlusIcon className="h-4 w-4" /> Nuevo tipo de plan
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Catálogo de <b>{pais}</b>: cada plan (número de cuotas) puede tener varios tipos, con sus montos de referencia en la moneda del país.
        Más adelante el tipo se elegirá en Crear Contrato. Un tipo en uso no se borra: se desactiva.
      </p>

      {editando !== null && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-800">{editando ? 'Editar tipo de plan' : `Nuevo tipo de plan · ${pais}`}</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {campo('cuotas', 'Plan (cuotas) *', 'number')}
            {campo('nombre', 'Tipo de plan *', 'text', 'md:col-span-2')}
            {campo('inscripcion', 'Inscripción', 'number')}
            {campo('valorCuota', 'Valor cuota', 'number')}
            {campo('total', 'Total plan', 'number')}
            {campo('descripcion', 'Descripción', 'text', 'col-span-2 md:col-span-6')}
          </div>
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activo} onChange={e => setForm(s => ({ ...s, activo: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300" /> Activo
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditando(null)} disabled={guardando}
                className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={() => enviar(form, editando || null)} disabled={guardando || !form.cuotas || !form.nombre.trim()}
                className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="p-8 text-center text-sm text-gray-400 italic">Cargando…</p>
      ) : !grupos.length ? (
        <p className="p-8 text-center text-sm text-gray-500">No hay planes para {pais}. Use <b>Nuevo tipo de plan</b>.</p>
      ) : grupos.map(([cuotas, tipos]) => (
        <div key={cuotas} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-800">
              Plan {cuotas} {cuotas === 1 ? '(contado)' : 'cuotas'} · {tipos.length} tipo{tipos.length !== 1 ? 's' : ''}
            </span>
            <button type="button" onClick={() => abrir(undefined, cuotas)} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline">
              <PlusIcon className="h-3.5 w-3.5" /> Agregar tipo
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="px-4 py-1.5">Tipo</th><th>Inscripción</th><th>Valor cuota</th><th>Total</th><th>Descripción</th><th>Contratos</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {tipos.map(t => (
                <tr key={t._id} className={`border-b border-gray-100 ${t.activo ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-1.5 font-medium text-gray-900">{t.nombre}</td>
                  <td>{fmtM(t.inscripcion)}</td>
                  <td>{fmtM(t.valorCuota)}</td>
                  <td>{fmtM(t.total)}</td>
                  <td className="text-xs text-gray-500 max-w-[220px] truncate" title={t.descripcion || ''}>{t.descripcion || '—'}</td>
                  <td>{t.contratos}</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${t.activo ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                      {t.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="pr-3 text-right whitespace-nowrap">
                    <button type="button" onClick={() => abrir(t)} title="Editar" className="p-1 text-gray-500 hover:text-indigo-700">
                      <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={guardando} onClick={() => enviar({ ...aForm(t), activo: !t.activo }, t._id)}
                      className="ml-1 text-xs font-medium text-gray-600 hover:underline">
                      {t.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
