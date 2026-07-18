import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import DashboardLayout from '@/components/layout/DashboardLayout'
import DashboardCampanias from '@/components/dashboard/DashboardCampanias'
import AdvisorDashboard from '@/components/dashboard/AdvisorDashboard'

export default async function HomePage() {
  // SIEMPRE verificar auth (comentado el bypass)
  // El Codespaces tiene DISABLE_AUTH=true pero .env.local tiene DISABLE_AUTH=false
  // Por ahora, SIEMPRE verificamos la sesión
  const session = await getServerSession(authOptions)
  if (!session) {
    redirect('/login')
  }

  // Students should not see the admin dashboard
  const userRole = (session.user as any)?.role
  if (userRole === 'ESTUDIANTE') {
    redirect('/panel-estudiante')
  }

  // ADVISOR: dashboard personalizado del mes corriente (KPIs + heatmap + 2 donuts),
  // datos filtrados por su _id resuelto desde el email de sesión.
  // No ve los stats globales ni las gráficas IA (que son agregados de plataforma).
  if (userRole === 'GUIA') {
    return (
      <DashboardLayout>
        <AdvisorDashboard />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="sm:flex sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Panel Administrativo</h1>
            <p className="mt-2 text-sm text-gray-700">
              Gestión completa de Let&apos;s Go Speak
            </p>
          </div>
        </div>

        {/* Campañas por estado + usuarios activos/inactivos + cursos activos por tipo */}
        <DashboardCampanias />
      </div>
    </DashboardLayout>
  )
}
