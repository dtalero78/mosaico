'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import GestionJustificacion from '@/components/servicio/GestionJustificacion'

/**
 * Servicio › Gestión Justificación.
 * Inasistencias del último mes y su justificación. Los roles administrativos
 * eligen el guía; con el rol GUIA el servidor limita la lista a sus cursos.
 */
export default function GestionJustificacionPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.JUSTIFICACION_VER as any} showDefaultMessage>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gestión Justificación</h1>
            <p className="text-sm text-gray-500">
              Inasistencias a las sesiones del curso (por defecto, el último mes). Justificar deja
              registrado el motivo; la falta sigue contando como ausencia.
            </p>
          </div>
          <GestionJustificacion />
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
