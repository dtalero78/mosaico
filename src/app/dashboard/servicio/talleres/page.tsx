'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import TalleresTab from '@/components/servicio/TalleresTab'

/**
 * Servicio › Talleres.
 *   Próximos   talleres que aún no terminan, por curso del alumno, con sus
 *              inscritos y el recordatorio por WhatsApp (plantilla
 *              "Recordatorio Taller").
 *   Histórico  talleres ya realizados con la asistencia de cada inscrito
 *              (por defecto, el último mes).
 * Las dos pestañas quedan montadas para no perder filtros al cambiar.
 */
export default function TalleresPage() {
  const [tab, setTab] = useState<'proximos' | 'historico'>('proximos')
  const [nProximos, setNProximos] = useState<number | null>(null)

  const btn = (id: 'proximos' | 'historico', label: string, n?: number | null) => (
    <button type="button" onClick={() => setTab(id)}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
      {n != null && <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{n}</span>}
    </button>
  )

  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.TALLERES_VER as any} showDefaultMessage>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Talleres</h1>
            <p className="text-sm text-gray-500">
              Inscritos a los talleres por curso: quién se inscribió desde su panel y quién fue agendado,
              el recordatorio por WhatsApp y la asistencia de los ya realizados.
            </p>
          </div>
          <div className="flex gap-2 border-b border-gray-200">
            {btn('proximos', 'Próximos', nProximos)}
            {btn('historico', 'Histórico')}
          </div>
          <div className={tab === 'proximos' ? '' : 'hidden'}><TalleresTab modo="proximos" onCount={setNProximos} /></div>
          <div className={tab === 'historico' ? '' : 'hidden'}><TalleresTab modo="historico" /></div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
