'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { MagnifyingGlassIcon, UserIcon, ChartBarIcon, UsersIcon } from '@heroicons/react/24/outline'
import AdvisorsList from '@/components/advisors/AdvisorsList'
import AdvisorsStatistics from '@/components/advisors/AdvisorsStatistics'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  email?: string
  telefono?: string
  numeroId?: string
  zoom?: string
}

type TabType = 'list' | 'statistics'

const tabs = [
  { id: 'list' as TabType, name: 'Lista de Guías', icon: UsersIcon },
  { id: 'statistics' as TabType, name: 'Estadísticas', icon: ChartBarIcon },
]

export default function AdvisorsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('list')
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cargar advisors al montar el componente
  useEffect(() => {
    fetchAdvisors()
  }, [])

  const fetchAdvisors = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/postgres/guias', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success) {
        setAdvisors(data.advisors || [])
      } else {
        throw new Error(data.error || 'Error al cargar advisors')
      }

    } catch (error) {
      console.error('Error fetching advisors:', error)
      setError(error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }


  // Función para navegar al detalle del advisor
  const handleAdvisorClick = (advisorId: string) => {
    router.push(`/advisor/${advisorId}`)
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.LISTA_ADVISORS_VER}>
        <div className="space-y-6">
          {/* Header */}
          <div className="border-b border-gray-200 pb-4">
            <h1 className="text-2xl font-bold text-gray-900">Guías</h1>
            <p className="mt-2 text-sm text-gray-600">
              Gestión y visualización de todos los guías del sistema
            </p>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      group inline-flex items-center py-2 px-1 border-b-2 font-medium text-sm transition-colors
                      ${isActive
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }
                    `}
                  >
                    <tab.icon
                      className={`
                        -ml-0.5 mr-2 h-5 w-5 transition-colors
                        ${isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'}
                      `}
                    />
                    {tab.name}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'list' && (
            <AdvisorsList
              advisors={advisors}
              loading={loading}
              error={error}
              onRetry={fetchAdvisors}
              onAdvisorClick={handleAdvisorClick}
            />
          )}

          {activeTab === 'statistics' && (
            <AdvisorsStatistics advisors={advisors} />
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}