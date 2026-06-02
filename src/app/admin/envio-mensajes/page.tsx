'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

/**
 * Stub "En construcción" para Envío Masivo de Mensajes WhatsApp.
 *
 * El item del sidebar (Mantenimiento > Usuarios > Envío Mensajes) ya existía
 * con su permiso `MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES`, pero la página
 * nunca fue creada — daba 404. Este stub mantiene el item navegable hasta
 * que se implemente la funcionalidad real (envío masivo a usuarios filtrados).
 */
export default function EnvioMensajesPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.ENVIO_MENSAJES}>
        <div className="max-w-3xl mx-auto py-12">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
              <ChatBubbleLeftRightIcon className="h-9 w-9 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Envío Masivo de Mensajes</h1>
            <p className="text-sm text-gray-500 mb-4">Mantenimiento &gt; Usuarios</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
              <p className="text-sm text-amber-900 font-semibold mb-1">🚧 En construcción</p>
              <p className="text-sm text-amber-800">
                Esta sección permitirá enviar mensajes WhatsApp masivos a usuarios filtrados
                (por nivel, plataforma, estado de contrato, etc.) usando plantillas
                predefinidas. La funcionalidad está pendiente de implementación.
              </p>
            </div>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
