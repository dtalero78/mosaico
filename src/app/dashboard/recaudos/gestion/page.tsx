'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import PagosValidacionPanel from '@/components/recaudos/PagosValidacionPanel'
import AjustesRecaudosPanel from '@/components/recaudos/AjustesRecaudosPanel'

export default function GestionRecaudosPage() {
  const { hasPermission } = usePermissions()
  const puedeAjustar =
    hasPermission(RecaudosPermission.AJUSTES_INSCRIPCION) ||
    hasPermission(RecaudosPermission.AJUSTES_PAGO) ||
    hasPermission(RecaudosPermission.AJUSTES_FACTURACION)
  const [vista, setVista] = useState<'validacion' | 'ajustes'>('validacion')

  return (
    <DashboardLayout>
      <PermissionGuard permission={RecaudosPermission.GESTION_VER} showDefaultMessage>
        {puedeAjustar && (
          <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
            {([['validacion', 'Centro de Validación'], ['ajustes', 'Ajustes']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setVista(k)}
                className={`px-4 py-1.5 rounded-md font-medium transition ${vista === k ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {vista === 'ajustes' && puedeAjustar
          ? <AjustesRecaudosPanel />
          : <PagosValidacionPanel variant="gestor" />}
      </PermissionGuard>
    </DashboardLayout>
  )
}
