'use client'

import { BanknotesIcon } from '@heroicons/react/24/outline'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission } from '@/types/permissions'

export default function GestionRecaudosPage() {
  return (
    <PermissionGuard permission={RecaudosPermission.GESTION_VER} showDefaultMessage>
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <BanknotesIcon className="h-7 w-7 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Recaudos</h1>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <BanknotesIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">En construcción</h2>
          <p className="text-sm text-gray-500">
            Esta página permitirá gestionar y validar los pagos registrados por gestor de recaudo.
            Próximamente.
          </p>
        </div>
      </div>
    </PermissionGuard>
  )
}
