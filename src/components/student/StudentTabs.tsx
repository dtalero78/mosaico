'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { Student, Class } from '@/types'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/usePermissions'
import { StudentPermission } from '@/types/permissions'
import StudentGeneral from './StudentGeneral'
import StudentAcademic from './StudentAcademic'
import StudentContract from './StudentContract'
import StudentWhatsApp from './StudentWhatsApp'
import StudentComments from './StudentComments'
import StudentProgress from './StudentProgress'
import StudentNivelacionHistorial from './StudentNivelacionHistorial'
import StudentChangeStep from './StudentChangeStep'
import StudentInicializarNivel from './StudentInicializarNivel'
import StudentCambioStepAuditado from './StudentCambioStepAuditado'
import StudentCambioAcademico from './StudentCambioAcademico'

interface StudentTabsProps {
  student: Student
  classes: Class[]
  contratoFinalizado?: boolean
  /** Si true, Información General muestra el badge SUSPENDIDA. */
  isSuspendida?: boolean
}

interface WelcomePreview {
  nombre: string
  numeroId: string | null
  actual: { curso: string | null; nivel: string | null; step: string | null; salon: string | null }
  destino: { campaign: string | null; curso: string | null; salon: string | null; nivel: string | null; step: string | null }
}

const tabs = [
  { id: 'general', name: 'Información General', icon: 'ℹ️' },
  { id: 'academic', name: 'Académica', icon: '📚', hasSubmenu: true },
  { id: 'contract', name: 'Contrato', icon: '📝' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '💬' },
  { id: 'comments', name: 'Comentarios', icon: '💭' },
]

export default function StudentTabs({ student, classes, contratoFinalizado = false, isSuspendida }: StudentTabsProps) {
  const [activeTab, setActiveTab] = useState('general')
  const [academicView, setAcademicView] = useState('attendance')
  const searchParams = useSearchParams()

  // Si se llega con ?agendar=<TIPO> (desde el reporte de Nivelaciones → Aprobar),
  // abrir directamente la pestaña Académica en vista Agendar para que
  // StudentAcademic monte y abra el modal de agendamiento con el tipo bloqueado.
  useEffect(() => {
    if (searchParams?.get('agendar')) {
      setActiveTab('academic')
      setAcademicView('schedule')
    }
  }, [searchParams])
  const [showAcademicSubmenu, setShowAcademicSubmenu] = useState(false)
  const [closeTimeout, setCloseTimeout] = useState<NodeJS.Timeout | null>(null)
  const [showChangeStepModal, setShowChangeStepModal] = useState(false)
  const [showInicializarModal, setShowInicializarModal] = useState(false)
  const [showCambioStepAuditadoModal, setShowCambioStepAuditadoModal] = useState(false)
  const [showCambioAcademicoModal, setShowCambioAcademicoModal] = useState(false)
  const [welcomeModal, setWelcomeModal] = useState<{
    loading: boolean
    submitting: boolean
    error: string | null
    preview: WelcomePreview | null
  } | null>(null)
  const { hasPermission, hasAnyPermission } = usePermissions()

  // Control de acceso: usuario necesita al menos uno de los permisos de Steps para ver el botón
  const canAccessSteps = hasAnyPermission([
    StudentPermission.MARCAR_STEP,
    StudentPermission.ASIGNAR_STEP,
  ])

  // Control de acceso: permiso para ver diagnóstico "¿Cómo voy?"
  const canAccessProgress = hasPermission(StudentPermission.COMO_VOY)

  // Control de acceso: permiso para cambiar step
  const canChangeStep = hasPermission(StudentPermission.ASIGNAR_STEP)

  // Control de acceso: permiso para inicializar nivel
  const canInicializarNivel = hasPermission(StudentPermission.INICIALIZAR_NIVEL)

  // Control de acceso: permiso para aprobar/promover desde WELCOME
  const canAprobarWelcome = hasPermission(StudentPermission.APROBAR_WELCOME)

  // Control de acceso: ítems que antes no estaban gateados (ahora todos requieren permiso)
  const canVerAsistencia = hasPermission(StudentPermission.VER_ASISTENCIA)
  const canVerNivelacion = hasPermission(StudentPermission.NIVELACION_HISTORIAL)
  const canAgendar = hasPermission(StudentPermission.AGENDAR_CLASE)
  const canCambioAcademico = hasPermission(StudentPermission.CAMBIO_ACADEMICO)

  // Filtrar submenu académico basado en permisos — TODOS los ítems gateados
  const academicSubmenu = [
    ...(canVerAsistencia ? [{ id: 'attendance', name: 'Tabla de Asistencia', icon: '📋' }] : []),
    ...(canAccessProgress ? [{ id: 'progress', name: '¿Cómo voy?', icon: '📈' }] : []),
    ...(canVerNivelacion ? [{ id: 'nivelacion-historial', name: 'Nivelación Historial', icon: '📜' }] : []),
    ...(canAgendar ? [{ id: 'schedule', name: 'Agendar Nueva Clase', icon: '📅' }] : []),
    ...(canAccessSteps ? [{ id: 'steps', name: 'Gestión de Steps', icon: '📊' }] : []),
    ...(canChangeStep ? [{ id: 'change-step', name: 'Cambiar Step', icon: '👣' }] : []),
    ...(canCambioAcademico ? [{ id: 'cambio-academico', name: 'Cambio Académico', icon: '🔀' }] : []),
    ...(canInicializarNivel ? [{ id: 'inicializar-nivel', name: 'Reiniciar Nivel', icon: '🔄' }] : []),
    ...(canAprobarWelcome ? [{ id: 'aprobar-welcome', name: 'Aprobar Welcome', icon: '✅' }] : []),
  ]

  // Debug: Log student data
  console.log('🧪 StudentTabs - student data:', student)
  console.log('🧪 StudentTabs - usuarioId:', student?.usuarioId)

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <StudentGeneral student={student} isSuspendida={isSuspendida} />
      case 'academic':
        // Si la vista académica es "progress", mostrar el componente de diagnóstico
        if (academicView === 'progress') {
          return <StudentProgress student={student} />
        }
        if (academicView === 'nivelacion-historial') {
          return <StudentNivelacionHistorial student={student} />
        }
        return <StudentAcademic student={student} classes={classes} view={academicView as any} />
      case 'contract':
        return <StudentContract student={student} contratoFinalizado={contratoFinalizado} />
      case 'whatsapp':
        return <StudentWhatsApp student={student} />
      case 'comments':
        return <StudentComments studentId={student._id} usuarioId={student.usuarioId} />
      default:
        return <StudentGeneral student={student} isSuspendida={isSuspendida} />
    }
  }

  const handleAcademicClick = () => {
    setActiveTab('academic')
    setAcademicView('attendance') // Always show attendance table by default
  }

  const confirmWelcome = () => {
    setWelcomeModal(prev => prev ? { ...prev, submitting: true, error: null } : prev)
    fetch(`/api/postgres/students/${student._id}/promote-welcome`, { method: 'POST' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error((d as any)?.error || 'Error al aprobar Welcome')
        toast.success('Estudiante promovido a su curso')
        setWelcomeModal(null)
        setTimeout(() => window.location.reload(), 700)
      })
      .catch(e => setWelcomeModal(prev => prev ? { ...prev, submitting: false, error: e.message || 'Error al aprobar Welcome' } : prev))
  }

  const handleMouseEnter = () => {
    if (closeTimeout) {
      clearTimeout(closeTimeout)
      setCloseTimeout(null)
    }
    setShowAcademicSubmenu(true)
  }

  const handleMouseLeave = () => {
    const timeout = setTimeout(() => {
      setShowAcademicSubmenu(false)
    }, 150) // 150ms delay antes de cerrar
    setCloseTimeout(timeout)
  }

  return (
    <div className="card">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            tab.hasSubmenu ? (
              <div
                key={tab.id}
                className="relative"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  onClick={handleAcademicClick}
                  className={cn(
                    "flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm",
                    activeTab === tab.id
                      ? "border-primary-500 text-primary-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  )}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.name}</span>
                  <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Submenu Dropdown */}
                {showAcademicSubmenu && (
                  <div className="absolute top-full left-0 pt-2 w-56 z-50">
                    <div className="bg-white rounded-md shadow-lg border border-gray-200">
                      <div className="py-1">
                        {academicSubmenu.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              // Aprobar Welcome: abre modal de confirmación con el curso destino
                              if (item.id === 'aprobar-welcome') {
                                setShowAcademicSubmenu(false)
                                if (closeTimeout) { clearTimeout(closeTimeout); setCloseTimeout(null) }
                                setWelcomeModal({ loading: true, submitting: false, error: null, preview: null })
                                fetch(`/api/postgres/students/${student._id}/promote-welcome`)
                                  .then(async r => {
                                    const d = await r.json().catch(() => ({}))
                                    if (!r.ok) throw new Error((d as any)?.error || 'No se pudo cargar el curso destino')
                                    setWelcomeModal({ loading: false, submitting: false, error: null, preview: d as WelcomePreview })
                                  })
                                  .catch(e => setWelcomeModal({ loading: false, submitting: false, error: e.message || 'Error', preview: null }))
                                return
                              }
                              // Si es "change-step" o "inicializar-nivel", abrir modal en lugar de cambiar vista
                              if (item.id === 'inicializar-nivel') {
                                setShowInicializarModal(true)
                                setShowAcademicSubmenu(false)
                                if (closeTimeout) { clearTimeout(closeTimeout); setCloseTimeout(null) }
                                return
                              }
                              if (item.id === 'cambio-step-auditado') {
                                setShowCambioStepAuditadoModal(true)
                                setShowAcademicSubmenu(false)
                                if (closeTimeout) { clearTimeout(closeTimeout); setCloseTimeout(null) }
                                return
                              }
                              if (item.id === 'cambio-academico') {
                                setShowCambioAcademicoModal(true)
                                setShowAcademicSubmenu(false)
                                if (closeTimeout) { clearTimeout(closeTimeout); setCloseTimeout(null) }
                                return
                              }
                              if (item.id === 'change-step') {
                                setShowChangeStepModal(true)
                                setShowAcademicSubmenu(false)
                                if (closeTimeout) {
                                  clearTimeout(closeTimeout)
                                  setCloseTimeout(null)
                                }
                              } else {
                                setActiveTab('academic')
                                setAcademicView(item.id)
                                setShowAcademicSubmenu(false)
                                if (closeTimeout) {
                                  clearTimeout(closeTimeout)
                                  setCloseTimeout(null)
                                }
                              }
                            }}
                            className={cn(
                              "flex items-center space-x-3 w-full px-4 py-2 text-sm text-left hover:bg-gray-50 transition-colors",
                              activeTab === 'academic' && academicView === item.id
                                ? "bg-primary-50 text-primary-700"
                                : "text-gray-700"
                            )}
                          >
                            <span>{item.icon}</span>
                            <span>{item.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm",
                  activeTab === tab.id
                    ? "border-primary-500 text-primary-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                )}
              >
                <span>{tab.icon}</span>
                <span>{tab.name}</span>
              </button>
            )
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {renderTabContent()}
      </div>

      {/* Modal Cambiar Step */}
      {showChangeStepModal && (
        <StudentChangeStep
          studentId={student._id}
          numeroId={student.numeroId}
          currentStep={student.step || 'Sin step'}
          currentNivel={student.nivel || 'Sin nivel'}
          studentName={`${student.primerNombre} ${student.primerApellido}`}
          onClose={() => setShowChangeStepModal(false)}
          onSuccess={() => {
            // Recargar la página para actualizar los datos
            window.location.reload()
          }}
        />
      )}

      {/* Modal Inicializar Nivel */}
      {showInicializarModal && (
        <StudentInicializarNivel
          studentId={student._id}
          studentName={`${student.primerNombre} ${student.primerApellido}`}
          onClose={() => setShowInicializarModal(false)}
          onSuccess={() => window.location.reload()}
        />
      )}

      {/* Modal Cambio Step Auditado */}
      {showCambioStepAuditadoModal && (
        <StudentCambioStepAuditado
          studentId={student._id}
          studentName={`${student.primerNombre} ${student.primerApellido}`}
          currentStep={student.step || 'Sin step'}
          currentNivel={student.nivel || 'Sin nivel'}
          onClose={() => setShowCambioStepAuditadoModal(false)}
          onSuccess={() => window.location.reload()}
        />
      )}

      {/* Modal Cambio Académico */}
      {showCambioAcademicoModal && (
        <StudentCambioAcademico
          studentId={student._id}
          studentName={`${student.primerNombre} ${student.primerApellido}`}
          currentCampaign={student.campaign}
          currentCurso={student.tipoCurso || student.curso}
          currentSalon={student.salon}
          onClose={() => setShowCambioAcademicoModal(false)}
          onSuccess={() => window.location.reload()}
        />
      )}

      {/* Modal Aprobar Welcome */}
      {welcomeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => { if (!welcomeModal.submitting) setWelcomeModal(null) }}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <span className="text-xl">✅</span>
              <h3 className="text-lg font-semibold text-gray-900">Aprobar Welcome</h3>
            </div>

            <div className="px-6 py-5">
              {welcomeModal.loading ? (
                <div className="py-6 text-center text-sm text-gray-500">Cargando curso destino…</div>
              ) : welcomeModal.error ? (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                  {welcomeModal.error}
                </div>
              ) : welcomeModal.preview ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Se promoverá al estudiante del curso puente <strong>WELCOME</strong> a su curso real.
                    Verifica los datos antes de confirmar.
                  </p>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Beneficiario</p>
                    <p className="text-base font-semibold text-gray-900">{welcomeModal.preview.nombre || '—'}</p>
                    {welcomeModal.preview.numeroId && (
                      <p className="text-xs text-gray-500">ID: {welcomeModal.preview.numeroId}</p>
                    )}
                  </div>

                  <div className="rounded-lg border border-primary-100 bg-primary-50/60 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-primary-700 mb-2">Se promoverá a</p>
                    <dl className="grid grid-cols-3 gap-y-2 text-sm">
                      <dt className="text-gray-500">Campaña</dt>
                      <dd className="col-span-2 font-medium text-gray-900">{welcomeModal.preview.destino.campaign || '—'}</dd>
                      <dt className="text-gray-500">Curso</dt>
                      <dd className="col-span-2 font-medium text-gray-900">{welcomeModal.preview.destino.curso || '—'}</dd>
                      <dt className="text-gray-500">Salón</dt>
                      <dd className="col-span-2 font-medium text-gray-900">{welcomeModal.preview.destino.salon || '—'}</dd>
                      <dt className="text-gray-500">Módulo</dt>
                      <dd className="col-span-2 font-medium text-gray-900">{welcomeModal.preview.destino.nivel || '—'}</dd>
                      <dt className="text-gray-500">Lección</dt>
                      <dd className="col-span-2 font-medium text-gray-900">{welcomeModal.preview.destino.step || '—'}</dd>
                    </dl>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setWelcomeModal(null)}
                disabled={welcomeModal.submitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmWelcome}
                disabled={welcomeModal.loading || welcomeModal.submitting || !welcomeModal.preview}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {welcomeModal.submitting ? 'Promoviendo…' : 'Confirmar y aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}