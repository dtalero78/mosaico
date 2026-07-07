'use client'

import { useState, useEffect } from 'react'
import { CalendarIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import AdvisorSelectionModal from './AdvisorSelectionModal'

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  email?: string
  telefono?: string
  numeroId?: string
  zoom?: string
}

interface AdvisorsStatisticsProps {
  advisors: Advisor[]
}

interface SelectedAdvisor extends Advisor {
  color: string
}

interface SessionData {
  date: string
  [key: string]: number | string // Para almacenar datos de diferentes advisors
}

const CHART_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
]

export default function AdvisorsStatistics({ advisors }: AdvisorsStatisticsProps) {
  const [selectedAdvisors, setSelectedAdvisors] = useState<SelectedAdvisor[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  })
  const [chartData, setChartData] = useState<SessionData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cargar datos cuando cambian los advisors seleccionados o el rango de fechas
  useEffect(() => {
    if (selectedAdvisors.length > 0) {
      fetchSessionsData()
    } else {
      setChartData([])
    }
  }, [selectedAdvisors, dateRange])

  const fetchSessionsData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Crear array de fechas para el período seleccionado
      const startDate = parseISO(dateRange.start)
      const endDate = parseISO(dateRange.end)
      const allDates = eachDayOfInterval({ start: startDate, end: endDate })

      // Inicializar datos del gráfico
      const initialData: SessionData[] = allDates.map(date => ({
        date: format(date, 'yyyy-MM-dd'),
        displayDate: format(date, 'dd MMM', { locale: es })
      }))

      // Obtener datos para cada advisor seleccionado
      for (const advisor of selectedAdvisors) {
        try {
          const response = await fetch('/api/postgres/guias', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              advisorId: advisor._id,
              fechaInicio: dateRange.start,
              fechaFin: dateRange.end
            })
          })

          if (!response.ok) {
            console.error(`Error fetching data for advisor ${advisor._id}:`, response.statusText)
            continue
          }

          const data = await response.json()

          if (data.success && data.stats && data.stats.chartData) {
            // Agregar datos del advisor al gráfico
            const advisorKey = `${advisor.primerNombre} ${advisor.primerApellido}`

            initialData.forEach(dayData => {
              const dayStats = data.stats.chartData.find((day: any) =>
                day.date === dayData.date
              )
              dayData[advisorKey] = dayStats ? dayStats.inscripciones : 0
            })
          }
        } catch (error) {
          console.error(`Error fetching advisor ${advisor._id} data:`, error)
        }
      }

      setChartData(initialData)

    } catch (error) {
      console.error('Error fetching sessions data:', error)
      setError('Error al cargar los datos de sesiones')
    } finally {
      setLoading(false)
    }
  }

  const handleAddAdvisor = (advisor: Advisor) => {
    if (selectedAdvisors.find(a => a._id === advisor._id)) {
      return // Ya está seleccionado
    }

    if (selectedAdvisors.length >= CHART_COLORS.length) {
      alert(`Máximo ${CHART_COLORS.length} advisors pueden ser comparados`)
      return
    }

    const newAdvisor: SelectedAdvisor = {
      ...advisor,
      color: CHART_COLORS[selectedAdvisors.length]
    }

    setSelectedAdvisors([...selectedAdvisors, newAdvisor])
    setIsModalOpen(false)
  }

  const handleRemoveAdvisor = (advisorId: string) => {
    setSelectedAdvisors(selectedAdvisors.filter(a => a._id !== advisorId))
  }

  const handleDateRangeChange = (field: 'start' | 'end', value: string) => {
    setDateRange(prev => ({
      ...prev,
      [field]: value
    }))
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Date Range */}
          <div className="flex items-center gap-4">
            <CalendarIcon className="h-5 w-5 text-gray-400" />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => handleDateRangeChange('start', e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
              <span className="text-gray-500">hasta</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => handleDateRangeChange('end', e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          {/* Add Advisor Button */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <PlusIcon className="h-4 w-4" />
            Agregar Advisor
          </button>
        </div>

        {/* Selected Advisors */}
        {selectedAdvisors.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Advisors seleccionados:</h4>
            <div className="flex flex-wrap gap-2">
              {selectedAdvisors.map((advisor) => (
                <div
                  key={advisor._id}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full text-sm"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: advisor.color }}
                  />
                  <span>{advisor.primerNombre} {advisor.primerApellido}</span>
                  <button
                    onClick={() => handleRemoveAdvisor(advisor._id)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-6">
          Sesiones Agendadas por Día
        </h3>

        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <span className="ml-2 text-gray-600">Cargando datos...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {!loading && !error && selectedAdvisors.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <CalendarIcon className="h-12 w-12 mb-4" />
            <p className="text-lg font-medium mb-2">No hay advisors seleccionados</p>
            <p className="text-sm">Selecciona uno o más advisors para ver sus estadísticas</p>
          </div>
        )}

        {!loading && !error && selectedAdvisors.length > 0 && chartData.length > 0 && (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="displayDate"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  labelFormatter={(label) => `Fecha: ${label}`}
                  formatter={(value: number, name: string) => [value, name]}
                />
                <Legend />
                {selectedAdvisors.map((advisor) => (
                  <Line
                    key={advisor._id}
                    type="monotone"
                    dataKey={`${advisor.primerNombre} ${advisor.primerApellido}`}
                    stroke={advisor.color}
                    strokeWidth={2}
                    dot={{ fill: advisor.color, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Advisor Selection Modal */}
      <AdvisorSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        advisors={advisors}
        selectedAdvisorIds={selectedAdvisors.map(a => a._id)}
        onSelectAdvisor={handleAddAdvisor}
      />
    </div>
  )
}