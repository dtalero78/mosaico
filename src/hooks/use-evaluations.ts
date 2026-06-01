'use client'

import { useQuery, useMutation, useQueryClient } from 'react-query'
import { api, handleApiError } from './use-api'
import toast from 'react-hot-toast'

const STUDENT_BASE = '/api/postgres/panel-estudiante'
const ADMIN_BASE   = '/api/postgres/reports/academico/performance-evaluation'
const FLAG_BASE    = '/api/admin/feature-flags/performance-eval'

const keys = {
  pendientes:    ['evaluations', 'pendientes'] as const,
  dashboard:     (filters: Record<string, string | null>) => ['evaluations', 'dashboard', filters] as const,
  flag:          ['evaluations', 'feature-flag'] as const,
}

/** Tarjeta "Sin Evaluar" + hard block antes de agendar. */
export function useEvaluacionesPendientes() {
  return useQuery(keys.pendientes, () => api.get(`${STUDENT_BASE}/evaluaciones-pendientes`), {
    staleTime: 30 * 1000,
  })
}

/** POST evaluación. Invalida pendientes para que la tarjeta se actualice. */
export function useEvaluarMutation() {
  const qc = useQueryClient()
  return useMutation(
    (input: {
      bookingId: string
      puntualidad: number; claridad: number; actividades: number; ambiente: number
      comentario?: string | null
    }) => api.post(`${STUDENT_BASE}/evaluar`, input),
    {
      onSuccess: () => {
        toast.success('Evaluación enviada — ¡gracias!')
        qc.invalidateQueries(keys.pendientes)
      },
      onError: (err: any) => handleApiError(err, 'Error al enviar evaluación'),
    }
  )
}

/** Dashboard admin de Performance Evaluation. */
export function usePerformanceDashboard(filters: {
  startDate?: string | null; endDate?: string | null;
  advisorId?: string | null; nivel?: string | null;
  tipo?: string | null; plataforma?: string | null;
  comentarioSearch?: string | null;
}) {
  const qs = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, String(v)) })
  return useQuery(
    keys.dashboard(filters as any),
    () => api.get(`${ADMIN_BASE}?${qs.toString()}`),
    { staleTime: 60 * 1000 }
  )
}

/** Feature flag SUPER_ADMIN. */
export function useFeatureFlag() {
  return useQuery(keys.flag, () => api.get(FLAG_BASE), { staleTime: 10 * 1000 })
}

export function useUpdateFeatureFlag() {
  const qc = useQueryClient()
  return useMutation(
    (input: { mode: 'off' | 'beta' | 'on'; betaUsers: string[] }) =>
      api.post(FLAG_BASE, input),
    {
      onSuccess: () => {
        toast.success('Feature flag actualizado')
        qc.invalidateQueries(keys.flag)
        qc.invalidateQueries(keys.pendientes)
      },
      onError: (err: any) => handleApiError(err, 'Error al guardar el flag'),
    }
  )
}
