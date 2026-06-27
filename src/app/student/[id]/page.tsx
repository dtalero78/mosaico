import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import StudentTabs from '@/components/student/StudentTabs'
import EstadoBadge from '@/components/common/EstadoBadge'
import { ContratoPruebaBadge } from '@/components/common/ContratoPruebaBadge'
import { getProfile, getAcademicHistory } from '@/services/student.service'
import { PermissionGuard } from '@/components/permissions'
import { StudentPermission } from '@/types/permissions'
import { formatDateTimeColombia } from '@/lib/utils'
import { isAdminSuspended } from '@/lib/contract-status'
import { formatEtapaNivelStep } from '@/lib/etapas'

// Force dynamic rendering to prevent page caching
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface StudentPageProps {
  params: {
    id: string
  }
}

export default async function StudentPage({ params }: StudentPageProps) {
  return (
    <DashboardLayout>
      <PermissionGuard permission={StudentPermission.ENVIAR_MENSAJE}>
        <Suspense fallback={<StudentPageLoading />}>
          <StudentContent studentId={params.id} />
        </Suspense>
      </PermissionGuard>
    </DashboardLayout>
  )
}

async function StudentContent({ studentId }: { studentId: string }) {
  try {
    const student = await getProfile(studentId)

    if (!student) {
      notFound()
    }

    let classes: any[] = []
    try {
      const academicData = await getAcademicHistory(studentId)
      classes = academicData.classes || []
    } catch {
      // Continue without classes if there's an error
    }

    // Find next scheduled class
    const now = new Date()
    const nextClass = classes
      .filter((cls: any) => {
        const classDate = new Date(cls.fechaEvento)
        return classDate > now && !cls.cancelo
      })
      .sort((a: any, b: any) => new Date(a.fechaEvento).getTime() - new Date(b.fechaEvento).getTime())[0]

    // Check if contract has expired
    const contratoFinalizado = student.finalContrato ?
      new Date(student.finalContrato) < now : false

    const suspendida = isAdminSuspended(student)

    return (
      <div className="space-y-6">
        {/* Student Header */}
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center flex-wrap gap-3">
                <h1 className={`text-2xl font-bold ${suspendida ? 'text-red-600' : 'text-gray-900'}`}>
                  {student.primerNombre} {student.primerApellido}
                </h1>
                <ContratoPruebaBadge contrato={student.contrato} />
              </div>
              <div className="mt-1 flex items-center flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                <span>ID: {student.numeroId || 'No disponible'}</span>
                <span>Contrato: {student.contrato || 'No disponible'}</span>
                <EstadoBadge estado={student.estado} prefix="Estado: " />
              </div>
              {((student as any).campaign || (student as any).curso || (student as any).salon || student.nivel || student.step) && (
                <div className="mt-1 flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                  {(student as any).campaign && <span>Campaña: {(student as any).campaign}</span>}
                  {(student as any).curso && <span>Curso: {(student as any).curso}</span>}
                  {(student as any).salon && <span>Salón: {(student as any).salon}</span>}
                  {student.nivel && <span>Módulo: {student.nivel}</span>}
                  {student.step && <span>Lección: {student.step}</span>}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end space-y-2">
              <div className="flex items-center space-x-2">
                <span className="badge badge-info">
                  BENEFICIARIO
                </span>
                {!student.existeEnAcademica && (
                  <span className="badge bg-red-100 text-red-700">
                    SIN REGISTRO ACADÉMICO
                  </span>
                )}
                {student.plataforma && (
                  <span className="badge badge-success">
                    {student.plataforma}
                  </span>
                )}
                {contratoFinalizado ? (
                  <span className="badge badge-error">
                    ❌ Aprobada
                  </span>
                ) : nextClass ? (
                  <span className="badge badge-warning">
                    Próxima Sesión: {formatDateTimeColombia(nextClass.fechaEvento)}
                  </span>
                ) : (
                  <span className="badge badge-secondary">
                    Próxima Sesión: Sin sesión futura
                  </span>
                )}
              </div>
              {/* OnHold Indicator - Only show if student has active OnHold dates */}
              {!contratoFinalizado && student.estadoInactivo && student.fechaOnHold && (
                <span className="badge badge-warning">
                  ⏸️ OnHold
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Student Tabs */}
        <StudentTabs
          student={student}
          classes={classes}
          contratoFinalizado={contratoFinalizado}
          isSuspendida={suspendida}
        />
      </div>
    )
  } catch (error) {
    console.error('Error loading student:', error)
    notFound()
  }
}

function StudentPageLoading() {
  return (
    <div className="space-y-6">
      <div className="card animate-pulse">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 bg-gray-200 rounded w-64 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-96"></div>
          </div>
          <div className="flex space-x-2">
            <div className="h-6 bg-gray-200 rounded w-20"></div>
            <div className="h-6 bg-gray-200 rounded w-16"></div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="h-96 bg-gray-200 rounded animate-pulse"></div>
      </div>
    </div>
  )
}