'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission } from '@/types/permissions'
import PagosValidacionPanel from '@/components/recaudos/PagosValidacionPanel'

export default function BancosRecaudosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={RecaudosPermission.BANCOS_VER} showDefaultMessage>
        <PagosValidacionPanel variant="medioPago" />
      </PermissionGuard>
    </DashboardLayout>
  )
}
