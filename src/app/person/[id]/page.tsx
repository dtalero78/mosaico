import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import PersonTabs from '@/components/person/PersonTabs'
import { PermissionGuard } from '@/components/permissions'
import { PersonPermission } from '@/types/permissions'

interface PersonPageProps {
  params: {
    id: string
  }
}

// Helper to get base URL for server-side fetch
function getBaseUrl() {
  // In production, use NEXTAUTH_URL
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL
  }
  // In development
  return 'http://localhost:3001'
}

export default async function PersonPage({ params }: PersonPageProps) {
  return (
    <DashboardLayout>
      <PermissionGuard permission={PersonPermission.VER_DOCUMENTACION}>
        <Suspense fallback={<PersonPageLoading />}>
          <PersonContent personId={params.id} />
        </Suspense>
      </PermissionGuard>
    </DashboardLayout>
  )
}

async function PersonContent({ personId }: { personId: string }) {
  try {
    // Call PostgreSQL API endpoint
    const baseUrl = getBaseUrl()
    console.log('🔍 [PersonPage] Fetching person from PostgreSQL:', personId)

    const response = await fetch(
      `${baseUrl}/api/postgres/people/${encodeURIComponent(personId)}`,
      { cache: 'no-store' }
    )

    if (!response.ok) {
      console.error('❌ [PersonPage] Error fetching person:', response.status, response.statusText)
      notFound()
    }

    const data = await response.json()

    if (!data.success || !data.person) {
      console.error('❌ [PersonPage] No person data returned')
      notFound()
    }

    console.log('✅ [PersonPage] Person loaded from PostgreSQL:', {
      id: data.person._id,
      nombre: `${data.person.primerNombre} ${data.person.primerApellido}`,
    })

    const personData = { person: data.person }
    const financialData = data.financialData

    // Transform related persons to beneficiaries format
    const beneficiaries = (data.relatedPersons || []).map((person: any) => ({
      _id: person._id,
      numeroId: person.numeroId,
      nombre: person.nombreCompleto?.split(' ')[0] || '',
      apellido: person.nombreCompleto?.split(' ').slice(1).join(' ') || '',
      celular: person.celular || '',
      estado: person.estadoInactivo ? 'Inactivo' : (person.aprobacion || 'Pendiente'),
      fechaCreacion: person._createdDate,
      nivel: person.nivel,
      existeEnAcademica: person.existeEnAcademica,
      estadoInactivo: person.estadoInactivo || false
    }))

    return (
      <div className="space-y-6">
        {/* Person Header */}
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {personData.person.primerNombre} {personData.person.primerApellido}
              </h1>
              <div className="mt-1 space-y-1">
                <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                  <span>ID: {personData.person.numeroId || 'No disponible'}</span>
                  {personData.person.contrato && (
                    <span>Contrato: {personData.person.contrato}</span>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                  {personData.person.fechaContrato && (
                    <span>Inicio Contrato: {new Date(personData.person.fechaContrato).toLocaleDateString('es-ES')}</span>
                  )}
                  {personData.person.finalContrato && (
                    <span>Final Contrato: {new Date(personData.person.finalContrato).toLocaleDateString('es-ES')}</span>
                  )}
                  {personData.person.vigencia && (
                    <span>Vigencia: {personData.person.vigencia}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="badge badge-info">
                {personData.person.tipoUsuario}
              </span>
              {personData.person.aprobacion && (
                <span className={`badge ${getEstadoBadgeClass(personData.person.aprobacion)}`}>
                  {personData.person.aprobacion}
                </span>
              )}
              {personData.person.plataforma && (
                <span className="badge badge-success">
                  {personData.person.plataforma}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Person Tabs */}
        <PersonTabs
          person={personData.person}
          financialData={financialData}
          beneficiaries={beneficiaries}
        />
      </div>
    )
  } catch (error) {
    console.error('❌ [PersonPage] Error loading person:', error)
    notFound()
  }
}

function PersonPageLoading() {
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

function getEstadoBadgeClass(estado: string): string {
  switch (estado) {
    case 'Aprobado':
      return 'badge-success'
    case 'Pendiente':
      return 'badge-warning'
    case 'Rechazado':
      return 'badge-danger'
    case 'ON HOLD':
      return 'badge-warning'
    default:
      return 'badge-info'
  }
}
