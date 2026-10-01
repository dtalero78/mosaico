'use client'

import { useState } from 'react'
import { Person } from '@/types'
import { formatDate } from '@/lib/utils'
import { ArrowDownTrayIcon, PaperClipIcon } from '@heroicons/react/24/outline'
import { PermissionGuard } from '@/components/permissions'
import { PersonPermission } from '@/types/permissions'
import PersonContractViewer from './PersonContractViewer'
import SuspendidaBadge from '@/components/common/SuspendidaBadge'
import DocumentosReciboModal from '@/components/common/DocumentosReciboModal'

interface PersonGeneralProps {
  person: Person
  /** Si true, muestra el badge "SUSPENDIDA" en la fila de botones. */
  isSuspendida?: boolean
}

export default function PersonGeneral({ person, isSuspendida }: PersonGeneralProps) {
  // "Documentación y recibo": el mismo modal del detalle del contrato. Reemplaza
  // los dos botones que había ("Ver Documentación" y "Agregar Documentación").
  const [showDocumentos, setShowDocumentos] = useState(false)

  // Descargar contrato PDF
  const downloadContrato = () => {
    if (!person._id) {
      alert('No se puede descargar el contrato: ID no disponible')
      return
    }
    // Descarga desde el Drive propio de MOSAICO (MOS_<contrato>.pdf); el endpoint
    // cae al Drive de LGS (bsl-utilidades) como respaldo para contratos viejos.
    const downloadUrl = `/api/contracts/${person._id}/download`
    window.open(downloadUrl, '_blank')
  }

  const nombre = [person.primerNombre, person.primerApellido].filter(Boolean).join(' ')

  return (
    <div className="space-y-8">
      {/* Action Buttons + Suspendida badge */}
      <div className="flex items-center flex-wrap gap-3">
        <PermissionGuard permission={PersonPermission.VER_CONTRATO}>
          <PersonContractViewer person={person as any} />
        </PermissionGuard>
        <PermissionGuard permission={PersonPermission.DESCARGAR_CONTRATO}>
          <button
            onClick={downloadContrato}
            className="btn-primary flex items-center space-x-2"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            <span>Descargar Contrato</span>
          </button>
        </PermissionGuard>
        <PermissionGuard anyPermissions={[PersonPermission.VER_DOCUMENTACION, PersonPermission.ADICION_DOCUMENTACION]}>
          <button
            onClick={() => setShowDocumentos(true)}
            className="btn-secondary flex items-center space-x-2"
          >
            <PaperClipIcon className="h-4 w-4" />
            <span>Documentación y recibo</span>
          </button>
        </PermissionGuard>
        <SuspendidaBadge
          show={!!isSuspendida}
          suspenddata={person.suspenddata ?? null}
          suspendcount={person.suspendcount}
        />
      </div>

      {/* Main Layout - Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Personal Data */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">👤 Datos Personales</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Primer Nombre</label>
              <p className="mt-1 text-sm text-gray-900">{person.primerNombre || 'No especificado'}</p>
            </div>
            {person.segundoNombre && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Segundo Nombre</label>
                <p className="mt-1 text-sm text-gray-900">{person.segundoNombre}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">Primer Apellido</label>
              <p className="mt-1 text-sm text-gray-900">{person.primerApellido || 'No especificado'}</p>
            </div>
            {person.segundoApellido && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Segundo Apellido</label>
                <p className="mt-1 text-sm text-gray-900">{person.segundoApellido}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">Número de Documento</label>
              <p className="mt-1 text-sm text-gray-900">{person.numeroId}</p>
            </div>
            {person.fechaNacimiento && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Fecha de Nacimiento</label>
                <p className="mt-1 text-sm text-gray-900">{formatDate(person.fechaNacimiento)}</p>
              </div>
            )}
            {person.plataforma && (
              <div>
                <label className="block text-sm font-medium text-gray-700">País/Plataforma</label>
                <span className="mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  {person.plataforma}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Contact and Location */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">📍 Contacto y Ubicación</h3>
          <div className="space-y-4">
            {/* Siempre visibles — "—" cuando el dato falta, para que se note el vacío
                (antes el campo desaparecía y parecía que el Email no existía). */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Celular</label>
              <p className="mt-1 text-sm text-gray-900">{person.celular || <span className="text-gray-400">—</span>}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-sm text-gray-900">{person.email || <span className="text-gray-400">—</span>}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Domicilio</label>
              <p className="mt-1 text-sm text-gray-900">{person.domicilio || <span className="text-gray-400">—</span>}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ciudad</label>
              <p className="mt-1 text-sm text-gray-900">{person.ciudad || <span className="text-gray-400">—</span>}</p>
            </div>
          </div>
        </div>
      </div>



      {/* System Details */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-800 mb-2">Detalles del Sistema</h4>
        <div className="text-xs text-gray-500 space-y-1">
          <p>• ID del Sistema: {person._id}</p>
          <p>• Fecha de Registro: {formatDate(person.fechaCreacion)}</p>
          <p>• Última Actualización: {formatDate(person.fechaCreacion)}</p>
        </div>
      </div>

      <DocumentosReciboModal
        open={showDocumentos}
        personId={person._id}
        subtitulo={`${nombre}${person.contrato ? ` · Contrato ${person.contrato}` : ''}`}
        onClose={() => setShowDocumentos(false)}
      />
    </div>
  )
}

function getEstadoBadgeClass(estado: string): string {
  switch (estado) {
    case 'Aprobado':
      return 'badge-success'
    case 'Pendiente':
      return 'badge-warning'
    case 'Rechazado':
      return 'badge-danger'
    case 'Contrato nulo':
      return 'badge-danger'
    case 'Devuelto':
      return 'badge-warning'
    default:
      return 'badge-info'
  }
}