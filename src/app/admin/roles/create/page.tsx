'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { UserPlusIcon } from '@heroicons/react/24/outline'

/**
 * Stub "En construcción" para Crear Rol.
 *
 * El item del sidebar (Mantenimiento > Usuarios > Crear Rol) ya existía con
 * su permiso `MANTENIMIENTO.USUARIOS.CREAR_ROL`, pero la página nunca fue
 * creada — daba 404. Este stub mantiene el item navegable hasta que se
 * implemente la funcionalidad real.
 *
 * Mientras tanto, los roles se crean directamente en `/admin/permissions`
 * (que tiene UI para administrar la matriz completa de roles y permisos).
 */
export default function CrearRolPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL}>
        <div className="max-w-3xl mx-auto py-12">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
              <UserPlusIcon className="h-9 w-9 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Crear Rol</h1>
            <p className="text-sm text-gray-500 mb-4">Mantenimiento &gt; Usuarios</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left mb-4">
              <p className="text-sm text-amber-900 font-semibold mb-1">🚧 En construcción</p>
              <p className="text-sm text-amber-800">
                Esta sección permitirá crear nuevos roles con su descripción y matriz
                de permisos en un wizard dedicado. La funcionalidad está pendiente de
                implementación.
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Por ahora, los roles se gestionan en{' '}
              <a href="/admin/permissions" target="_blank" rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-700 underline font-medium">
                Matriz de Permisos
              </a>.
            </p>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
