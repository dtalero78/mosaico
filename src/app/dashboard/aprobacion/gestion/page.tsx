'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AprobacionPermission } from '@/types/permissions'
import { ShieldCheck } from 'lucide-react'

export default function GestionAprobacionesPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AprobacionPermission.GESTION_VER} showDefaultMessage>
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary-600" /> Gestión Aprobaciones
            </h1>
            <p className="mt-1 text-gray-600">Gestión de aprobaciones.</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
            <ShieldCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">En construcción.</p>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
