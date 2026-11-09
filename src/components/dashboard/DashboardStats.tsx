'use client'

import { useQuery } from 'react-query'
import { UsersIcon, AcademicCapIcon, CheckCircleIcon, CalendarDaysIcon } from '@heroicons/react/24/outline'

interface DashboardStatsData {
  totalUsuarios: number
  totalInactivos: number
  sesionesHoy: number
  usuariosInscritosHoy: number
  advisorsHoy: number
}

export default function DashboardStats() {
  const { data: stats, isLoading, error } = useQuery<DashboardStatsData>(
    'dashboard-stats',
    fetchDashboardStats,
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchInterval: 10 * 60 * 1000, // Refresh every 10 minutes
    }
  )

  if (isLoading) {
    return <DashboardStatsLoading />
  }

  if (error) {
    console.error('Dashboard stats error:', error)
  }

  const statsData = stats || {
    totalUsuarios: 0,
    totalInactivos: 0,
    sesionesHoy: 0,
    usuariosInscritosHoy: 0,
    advisorsHoy: 0
  }

  const statsConfig = [
    {
      name: 'Total de Usuarios',
      value: statsData.totalUsuarios.toLocaleString(),
      icon: UsersIcon,
      description: 'Usuarios registrados en ACADEMICA'
    },
    {
      name: 'Usuarios Inactivos',
      value: statsData.totalInactivos.toLocaleString(),
      icon: UsersIcon,
      description: 'Usuarios con estado activo'
    },
    {
      name: 'Sesiones Agendadas Hoy',
      value: statsData.sesionesHoy.toLocaleString(),
      icon: CalendarDaysIcon,
      description: 'Eventos en CALENDARIO para hoy'
    },
    {
      name: 'Usuarios Inscritos Hoy',
      value: statsData.usuariosInscritosHoy.toLocaleString(),
      icon: AcademicCapIcon,
      description: 'Registros en CLASSES para hoy'
    },
    {
      name: 'Guías Agendados Hoy',
      value: statsData.advisorsHoy.toLocaleString(),
      icon: CheckCircleIcon,
      description: 'Guías únicos con eventos hoy'
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {statsConfig.map((stat) => (
        <div key={stat.name} className="card p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className="h-5 w-5 text-primary-600 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-600 truncate">
              {stat.name}
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900 leading-tight">{stat.value}</div>
          <div className="text-[11px] text-gray-500 mt-1 leading-snug">{stat.description}</div>
        </div>
      ))}
    </div>
  )
}

function DashboardStatsLoading() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="card p-4 animate-pulse flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-5 w-5 bg-gray-200 rounded flex-shrink-0"></div>
            <div className="h-3 bg-gray-200 rounded flex-1"></div>
          </div>
          <div className="h-7 bg-gray-200 rounded w-1/2 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-full"></div>
        </div>
      ))}
    </div>
  )
}

async function fetchDashboardStats(): Promise<DashboardStatsData> {
  try {
    const response = await fetch('/api/dashboard/stats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()

    if (data.success && data.stats) {
      return {
        totalUsuarios: data.stats.totalUsuarios || 0,
        totalInactivos: data.stats.totalInactivos || 0,
        sesionesHoy: data.stats.sesionesHoy || 0,
        usuariosInscritosHoy: data.stats.usuariosInscritosHoy || 0,
        advisorsHoy: data.stats.advisorsHoy || 0,
      }
    } else {
      throw new Error(data.error || 'Failed to fetch dashboard stats')
    }
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    throw error
  }
}