'use client'

import { useState } from 'react'
import { Person } from '@/types'
import { formatDate } from '@/lib/utils'
import { ArrowDownTrayIcon, ArrowUpTrayIcon, DocumentTextIcon, PhotoIcon } from '@heroicons/react/24/outline'
import { PermissionGuard } from '@/components/permissions'
import { PersonPermission } from '@/types/permissions'
import { api, handleApiError } from '@/hooks/use-api'
import toast from 'react-hot-toast'
import PersonContractViewer from './PersonContractViewer'
import SuspendidaBadge from '@/components/common/SuspendidaBadge'

interface PersonGeneralProps {
  person: Person
  /** Si true, muestra el badge "SUSPENDIDA" en la fila de botones. */
  isSuspendida?: boolean
}

export default function PersonGeneral({ person, isSuspendida }: PersonGeneralProps) {
  const [showDocuments, setShowDocuments] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])

  // Descargar contrato PDF
  const downloadContrato = () => {
    if (!person._id) {
      alert('No se puede descargar el contrato: ID no disponible')
      return
    }
    const downloadUrl = `https://bsl-utilidades-yp78a.ondigitalocean.app/descargar-pdf-drive/${person._id}?empresa=LGS`
    window.open(downloadUrl, '_blank')
  }

  // Ver documentación
  const viewDocuments = () => {
    setShowDocuments(true)
  }

  const [docs, setDocs] = useState(() => {
    const rawDocs: any[] = (person as any).documentacion || []
    return rawDocs.map((entry: any) => {
      if (typeof entry === 'string') {
        const urlMatch = entry.match(/wix:image:\/\/v1\/([^/]+)\//)
        const url = urlMatch ? `https://static.wixstatic.com/media/${urlMatch[1]}` : entry
        const nameMatch = entry.match(/\/([^/#]+?)(?:#|$)/)
        const nombre = nameMatch ? decodeURIComponent(nameMatch[1]) : 'Documento'
        const tipo = entry.includes('.pdf') ? 'application/pdf' : 'image/jpeg'
        return { url, nombre, tipo }
      }
      return entry as { url: string; nombre: string; tipo?: string; fechaSubida?: string }
    })
  })

  const handleFileUpload = async (files: File[]) => {
    if (!files.length) return
    for (const file of files) {
      setUploadingFiles(prev => [...prev, file.name])
      try {
        const formData = new FormData()
        formData.append('file', file)
        const uploadRes = await fetch(`/api/contracts/${person._id}/upload-url`, {
          method: 'POST',
          body: formData,
        })
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}))
          throw new Error(err.error || `Upload failed: ${uploadRes.status}`)
        }
        const { publicUrl } = await uploadRes.json()
        const saved = await api.post(`/api/contracts/${person._id}/documents`, {
          url: publicUrl,
          nombre: file.name,
          tipo: file.type,
        })
        setDocs(saved.documentacion || [])
        toast.success(`${file.name} subido`)
      } catch (err) {
        handleApiError(err, `Error subiendo ${file.name}`)
      } finally {
        setUploadingFiles(prev => prev.filter(n => n !== file.name))
      }
    }
  }

  const openFileChooser = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      handleFileUpload(Array.from(input.files || []))
      document.body.removeChild(input)
    })
    input.click()
  }

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
        <PermissionGuard permission={PersonPermission.VER_DOCUMENTACION}>
          <button
            onClick={viewDocuments}
            className="btn-secondary flex items-center space-x-2"
          >
            <DocumentTextIcon className="h-4 w-4" />
            <span>Ver Documentación</span>
          </button>
        </PermissionGuard>
        <PermissionGuard permission={PersonPermission.VER_DOCUMENTACION}>
          <button
            onClick={openFileChooser}
            disabled={uploadingFiles.length > 0}
            className="btn-secondary flex items-center space-x-2"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            <span>{uploadingFiles.length > 0 ? `Subiendo (${uploadingFiles.length})...` : 'Agregar Documentación'}</span>
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
            {person.celular && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Celular</label>
                <p className="mt-1 text-sm text-gray-900">{person.celular}</p>
              </div>
            )}
            {person.email && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <p className="mt-1 text-sm text-gray-900">{person.email}</p>
              </div>
            )}
            {person.domicilio && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Domicilio</label>
                <p className="mt-1 text-sm text-gray-900">{person.domicilio}</p>
              </div>
            )}
            {person.ciudad && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Ciudad</label>
                <p className="mt-1 text-sm text-gray-900">{person.ciudad}</p>
              </div>
            )}
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

      {/* Documents Modal */}
      {showDocuments && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-96 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Documentación del Contrato</h3>
              <button
                onClick={() => setShowDocuments(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {docs.map((doc, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-center space-x-3">
                    {doc.tipo?.startsWith('image/') ? (
                      <img src={doc.url} alt={doc.nombre} className="h-12 w-12 rounded object-cover flex-shrink-0 border border-gray-200" />
                    ) : (
                      <DocumentTextIcon className="h-8 w-8 text-red-400 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{doc.nombre}</p>
                      <p className="text-xs text-gray-500">{doc.tipo?.startsWith('image/') ? 'Imagen' : 'PDF'}</p>
                    </div>
                  </div>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-sm text-primary-600 hover:text-primary-800 block"
                  >
                    Ver documento
                  </a>
                </div>
              ))}
            </div>
            {docs.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">
                No hay documentos disponibles
              </p>
            )}
          </div>
        </div>
      )}
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