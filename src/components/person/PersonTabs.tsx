'use client'

import { useEffect, useMemo, useState } from 'react'
import { Person, FinancialData, Beneficiary } from '@/types'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/usePermissions'
import { PersonPermission } from '@/types/permissions'
import PersonGeneral from './PersonGeneral'
import PersonContact from './PersonContact'
import PersonFinancial from './PersonFinancial'
import PersonAdmin from './PersonAdmin'
import PersonComments from './PersonComments'
import PersonDocuments from './PersonDocuments'

interface PersonTabsProps {
  person: Person
  financialData?: FinancialData
  beneficiaries: Beneficiary[]
  /** Tab inicial. Acepta el id interno o un alias amigable de URL (ej. 'financiera' → 'financial'). */
  initialTab?: string
  /** Si true, el contrato está suspendido administrativamente
   *  (Información General mostrará el badge SUSPENDIDA). */
  isSuspendida?: boolean
  /** Si true, sólo se habilita "Información General" (las demás pestañas quedan
   *  deshabilitadas). Usado por Comercial › Gestión Contrato para adjuntar docs. */
  soloGeneral?: boolean
}

const tabs = [
  { id: 'general', name: 'Información General', icon: 'ℹ️' },
  { id: 'contact', name: 'Contacto y Referencias', icon: '📞' },
  { id: 'financial', name: 'Financiera', icon: '💰' },
  { id: 'admin', name: 'Administración', icon: '⚙️' },
  { id: 'comments', name: 'Comentarios', icon: '💬' },
  { id: 'docs', name: 'Documentación', icon: '📎' },
]

/**
 * Qué permiso hace falta para VER cada pestaña: basta con tener UNO de los de su
 * sección. Sin ninguno, la pestaña no se muestra — antes se veía siempre y sólo
 * se ocultaban los botones de adentro, así que un rol sin permisos de gestión
 * seguía entrando a "Administración" y viendo el contrato y sus beneficiarios.
 *
 * `general` y `comments` no llevan candado: la primera es la ficha en sí (sin
 * ella la página quedaría en blanco) y la segunda no tiene permisos definidos en
 * el catálogo, así que no hay nada que desmarcar.
 */
const TAB_PERMISOS: Record<string, string[]> = {
  contact: [PersonPermission.CAMBIO_CELULAR, PersonPermission.WHATSAPP],
  financial: [
    PersonPermission.RESUMEN_FINANCIERO_VER, PersonPermission.INFO_PAGOS_VER,
    PersonPermission.PAGOS_VER, PersonPermission.PAGOS_REGISTRAR,
    PersonPermission.PAGOS_EDITAR, PersonPermission.PAGOS_VALIDAR,
    PersonPermission.PAGOS_ELIMINAR, PersonPermission.PAGOS_RECIBO,
    PersonPermission.ASIGNAR_GESTOR_RECAUDO, PersonPermission.CAMBIO_ESTADO_CARTERA,
    PersonPermission.MARCAR_OPCIONAL,
  ],
  admin: [
    PersonPermission.ACTIVAR_DESACTIVAR, PersonPermission.CAMBIAR_ESTADO,
    PersonPermission.APROBAR, PersonPermission.ELIMINAR,
    PersonPermission.AGREGAR_BENEFICIARIO,
  ],
  docs: [PersonPermission.VER_DOCUMENTACION, PersonPermission.ADICION_DOCUMENTACION],
}

// Alias para deep-links desde URL (?tab=financiera, ?tab=admin, etc.)
const TAB_ALIASES: Record<string, string> = {
  financiera: 'financial',
  financial: 'financial',
  general: 'general',
  contacto: 'contact',
  contact: 'contact',
  administracion: 'admin',
  administración: 'admin',
  admin: 'admin',
  comentarios: 'comments',
  comments: 'comments',
  documentacion: 'docs',
  documentación: 'docs',
  docs: 'docs',
}

function resolveInitialTab(initial?: string): string {
  if (!initial) return 'general'
  const key = initial.toLowerCase()
  return TAB_ALIASES[key] || 'general'
}

export default function PersonTabs({ person, financialData, beneficiaries, initialTab, isSuspendida, soloGeneral }: PersonTabsProps) {
  const [activeTab, setActiveTab] = useState(() => (soloGeneral ? 'general' : resolveInitialTab(initialTab)))

  // Mientras los permisos cargan se muestran sólo las pestañas sin candado: es
  // preferible que las demás aparezcan un instante después a que parpadee una
  // que el usuario no puede abrir.
  const { hasAnyPermission, isLoading: permisosCargando } = usePermissions()
  const visibles = useMemo(
    () => tabs.filter(t => {
      const req = TAB_PERMISOS[t.id]
      if (!req) return true
      return permisosCargando ? false : hasAnyPermission(req as any)
    }),
    [permisosCargando, hasAnyPermission])

  // Si la pestaña activa no está permitida (deep link con ?tab=admin, o el admin
  // acaba de quitar el permiso), se cae a la primera visible en vez de dejar el
  // contenido colgado.
  const permitida = visibles.some(t => t.id === activeTab)
  useEffect(() => {
    if (!permisosCargando && !permitida) setActiveTab(visibles[0]?.id || 'general')
  }, [permisosCargando, permitida, visibles])

  const renderTabContent = () => {
    if (!permitida) return <PersonGeneral person={person} isSuspendida={isSuspendida} />
    switch (activeTab) {
      case 'general':
        return <PersonGeneral person={person} isSuspendida={isSuspendida} />
      case 'contact':
        return <PersonContact person={person} />
      case 'financial':
        return <PersonFinancial person={person} financialData={financialData} />
      case 'admin':
        return <PersonAdmin person={person} beneficiaries={beneficiaries} />
      case 'comments':
        return <PersonComments personId={person._id} />
      case 'docs':
        return <PersonDocuments documents={person.documentacion || []} />
      default:
        return <PersonGeneral person={person} isSuspendida={isSuspendida} />
    }
  }

  return (
    <div className="card">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {visibles.map((tab) => {
            const bloqueada = soloGeneral && tab.id !== 'general'
            return (
            <button
              key={tab.id}
              onClick={() => { if (!bloqueada) setActiveTab(tab.id) }}
              disabled={bloqueada}
              title={bloqueada ? 'Disponible sólo desde el detalle completo del contrato' : ''}
              className={cn(
                "flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm",
                bloqueada
                  ? "border-transparent text-gray-300 cursor-not-allowed"
                  : activeTab === tab.id
                    ? "border-primary-500 text-primary-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              <span>{tab.icon}</span>
              <span>{tab.name}</span>
            </button>
          )})}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {renderTabContent()}
      </div>
    </div>
  )
}