'use client'

import { useQuery, useMutation, useQueryClient } from 'react-query'
import { api, handleApiError } from './use-api'
import toast from 'react-hot-toast'

const BASE = '/api/postgres/panel-estudiante'

// ─── Query Keys ───
const keys = {
  me: ['panel-estudiante', 'me'] as const,
  events: ['panel-estudiante', 'events'] as const,
  stats: ['panel-estudiante', 'stats'] as const,
  progress: ['panel-estudiante', 'progress'] as const,
  history: ['panel-estudiante', 'history'] as const,
  materials: ['panel-estudiante', 'materials'] as const,
  actividades: ['panel-estudiante', 'actividades'] as const,
  comments: ['panel-estudiante', 'comments'] as const,
  availableEvents: (date: string, tipo?: string) =>
    ['panel-estudiante', 'available-events', date, tipo] as const,
  diasConEventos: (desde: string, hasta: string, tipo?: string) =>
    ['panel-estudiante', 'available-events', 'dias', desde, hasta, tipo] as const,
}

// ─── Queries ───

/** Fetch the logged-in student's profile */
export function useStudentMe() {
  return useQuery(keys.me, () => api.get(`${BASE}/me`))
}

/** Fetch upcoming events for the student */
export function useStudentEvents() {
  return useQuery(keys.events, () => api.get(`${BASE}/events`))
}

/** Fetch attendance statistics */
export function useStudentStats() {
  return useQuery(keys.stats, () => api.get(`${BASE}/stats`))
}

/** Fetch progress report ("¿Cómo voy?") */
export function useStudentPanelProgress() {
  return useQuery(keys.progress, () => api.get(`${BASE}/progress`), {
    staleTime: 10 * 60 * 1000,
  })
}

/** Fetch available events for booking */
export function useAvailableEvents(date: string, tipo?: string) {
  const params = new URLSearchParams({ date })
  if (tipo) params.set('tipo', tipo)
  // Send client timezone offset so backend can compute correct date range
  const tzOffset = new Date().getTimezoneOffset()
  params.set('tzOffset', String(tzOffset))
  return useQuery(
    keys.availableEvents(date, tipo),
    () => api.get(`${BASE}/available-events?${params}`),
    { enabled: !!date }
  )
}

/**
 * Días del rango (YYYY-MM-DD locales) con al menos un evento del tipo. El
 * selector de fecha de los Talleres pinta con él los días con taller. Con
 * `desde`/`hasta` vacíos no consulta (los demás tipos no lo necesitan).
 */
export function useDiasConEventos(desde: string, hasta: string, tipo?: string) {
  const params = new URLSearchParams({ desde, hasta })
  if (tipo) params.set('tipo', tipo)
  params.set('tzOffset', String(new Date().getTimezoneOffset()))
  return useQuery<{ dias: string[] }>(
    keys.diasConEventos(desde, hasta, tipo),
    () => api.get(`${BASE}/available-events/dias?${params}`),
    { enabled: !!desde && !!hasta, staleTime: 60 * 1000 }
  )
}

/** Fetch class history */
export function useStudentHistory() {
  return useQuery(keys.history, () => api.get(`${BASE}/history`))
}

/** Fetch materials for current nivel */
export function useStudentMaterials() {
  return useQuery(keys.materials, () => api.get(`${BASE}/materials`))
}

/** Fetch actividades (Kahoot/WordWall) de la lección actual */
export function useStudentActividades() {
  return useQuery(keys.actividades, () => api.get(`${BASE}/actividades`))
}

/** Fetch advisor comments */
export function useStudentComments() {
  return useQuery(keys.comments, () => api.get(`${BASE}/comments`))
}

// ─── Mutations ───

/** Book an event */
export function useBookEvent() {
  const qc = useQueryClient()
  return useMutation(
    (eventId: string) => api.post(`${BASE}/book`, { eventId }),
    {
      onSuccess: () => {
        qc.invalidateQueries(['panel-estudiante'])
        toast.success('Clase agendada exitosamente')
      },
      onError: (err) => handleApiError(err, 'Error agendando clase'),
    }
  )
}

/** Cancel a booking */
export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation(
    (bookingId: string) => api.post(`${BASE}/cancel`, { bookingId }),
    {
      onSuccess: () => {
        qc.invalidateQueries(['panel-estudiante'])
        toast.success('Clase cancelada')
      },
      onError: (err) => handleApiError(err, 'Error cancelando clase'),
    }
  )
}
