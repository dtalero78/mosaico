import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import GuiaEditForm from '@/components/advisor/GuiaEditForm'

interface AdvisorPageProps {
  params: { id: string }
}

/**
 * Detalle/edición de un guía. MOSAICO: opera sobre GUIAS.
 * Ver: requiere ACADEMICO.ADVISOR.LISTA_VER. Editar/guardar: requiere
 * ACADEMICO.GUIA.EDITAR (el form se muestra en solo-lectura si no se tiene).
 */
export default function AdvisorPage({ params }: AdvisorPageProps) {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.LISTA_ADVISORS_VER} showDefaultMessage>
        <GuiaEditForm advisorId={params.id} />
      </PermissionGuard>
    </DashboardLayout>
  )
}
