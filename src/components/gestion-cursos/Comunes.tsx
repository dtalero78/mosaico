'use client'

import { ReactNode } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { Permission } from '@/types/permissions'

/**
 * Piezas comunes de Académico › Gestión Cursos (Ausencias, Seguimiento Cursos y
 * Curso Guía): marco de página con permiso, selector de filtro y el aviso de que
 * la consulta sólo corre al pulsar «Consultar».
 */

export function MarcoPagina({ permiso, titulo, descripcion, children }: {
  permiso: Permission; titulo: string; descripcion: string; children: ReactNode
}) {
  return (
    <DashboardLayout>
      <PermissionGuard permission={permiso} showDefaultMessage>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
            <p className="text-sm text-gray-500 mt-1">{descripcion}</p>
          </div>
          {children}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}

export const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white'

export function Campo({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

export function SelectFiltro({ id, label, valor, onChange, opciones, todos }: {
  id: string; label: string; valor: string; onChange: (v: string) => void
  opciones: Array<string | { id: string; nombre: string }>; todos: string
}) {
  return (
    <Campo id={id} label={label}>
      <select id={id} value={valor} onChange={e => onChange(e.target.value)} className={inputCls}>
        <option value="">{todos}</option>
        {opciones.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </select>
    </Campo>
  )
}

export function BotonesConsulta({ cargando, onConsultar, onLimpiar, exportar }: {
  cargando: boolean; onConsultar: () => void; onLimpiar: () => void; exportar?: ReactNode
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-4">
      <button type="button" onClick={onConsultar} disabled={cargando}
        className="px-4 py-2 text-sm font-medium text-white bg-primary-700 rounded-md hover:bg-primary-800 disabled:opacity-50">
        {cargando ? 'Consultando…' : 'Consultar'}
      </button>
      <button type="button" onClick={onLimpiar}
        className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">Borrar filtros</button>
      {exportar}
    </div>
  )
}

export function AvisoSinConsulta() {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
      Elige los filtros y pulsa <strong>Consultar</strong>. La consulta no corre sola.
    </div>
  )
}

/** Cuántos alumnos efectivos tiene el curso: en rojo si ≤ 3 (candidato a fusión). */
export function Efectivos({ n }: { n: number }) {
  return (
    <span className={`inline-flex min-w-[2rem] justify-center text-xs font-bold px-2 py-0.5 rounded-full ${n <= 3 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
      title={n <= 3 ? 'Candidato a fusión: 3 alumnos o menos' : undefined}>
      {n}
    </span>
  )
}

export function EtiquetaEstado({ completo }: { completo: boolean }) {
  return completo
    ? <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Completo</span>
    : <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Disminuido</span>
}

export const tablaCls = 'w-full text-sm'
export const thCls = 'text-left font-medium px-3 py-2 text-xs text-gray-500 uppercase'
export const tdCls = 'px-3 py-2'
