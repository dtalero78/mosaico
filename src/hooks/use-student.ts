'use client'

import { useQuery, useMutation, useQueryClient } from 'react-query'
import { api, handleApiError } from './use-api'
import toast from 'react-hot-toast'

// ─── Query Keys ───
const keys = {
  profile: (id: string) => ['student', id] as const,
  academic: (id: string) => ['student', id, 'academic'] as const,
  progress: (id: string) => ['student', id, 'progress'] as const,
  steps: (nivel: string, studentId?: string) => ['niveles', nivel, 'steps', studentId] as const,
}

// ─── Queries ───

/** Fetch student profile (tries ACADEMICA first, then PEOPLE) */
export function useStudentProfile(id: string | undefined) {
  return useQuery(
    keys.profile(id!),
    () => api.get(`/api/postgres/students/${encodeURIComponent(id!)}`),
    { enabled: !!id }
  )
}

/** Fetch academic history for a student */
export function useStudentAcademic(studentId: string | undefined) {
  return useQuery(
    keys.academic(studentId!),
    () => api.get(`/api/postgres/students/${encodeURIComponent(studentId!)}/academic`),
    { enabled: !!studentId }
  )
}

/** Fetch student progress report ("¿Cómo voy?") */
export function useStudentProgress(studentId: string | undefined) {
  return useQuery(
    keys.progress(studentId!),
    () => api.get(`/api/postgres/students/${encodeURIComponent(studentId!)}/progress`),
    { enabled: !!studentId, staleTime: 10 * 60 * 1000 }
  )
}

/** Fetch steps for a nivel with student overrides */
export function useNivelSteps(nivel: string | undefined, studentId?: string) {
  const params = new URLSearchParams()
  if (studentId) params.set('studentId', studentId)
  return useQuery(
    keys.steps(nivel!, studentId),
    () => api.get(`/api/postgres/niveles/${encodeURIComponent(nivel!)}/steps?${params}`),
    { enabled: !!nivel }
  )
}

// ─── Mutations ───

/** Update student fields (PATCH) */
export function useUpdateStudent(studentId: string) {
  const qc = useQueryClient()
  return useMutation(
    (body: Record<string, any>) => api.patch(`/api/postgres/students/${encodeURIComponent(studentId)}/update`, body),
    {
      onSuccess: () => {
        qc.invalidateQueries(keys.profile(studentId))
        toast.success('Estudiante actualizado')
      },
      onError: (err) => handleApiError(err, 'Error actualizando estudiante'),
    }
  )
}

/** Toggle student on-hold status */
export function useToggleOnHold(studentId: string) {
  const qc = useQueryClient()
  return useMutation(
    (body: { setOnHold: boolean; fechaOnHold?: string; fechaFinOnHold?: string; motivo?: string }) =>
      api.post('/api/postgres/students/onhold', { studentId, ...body }),
    {
      onSuccess: (data) => {
        qc.invalidateQueries(keys.profile(studentId))
        toast.success(data.message || 'Estado OnHold actualizado')
      },
      onError: (err) => handleApiError(err, 'Error actualizando OnHold'),
    }
  )
}

/** Extend student contract */
export function useExtendContract(studentId: string) {
  const qc = useQueryClient()
  return useMutation(
    (body: { dias: number; motivo: string }) =>
      api.post(`/api/postgres/students/${encodeURIComponent(studentId)}/extend`, body),
    {
      onSuccess: () => {
        qc.invalidateQueries(keys.profile(studentId))
        toast.success('Contrato extendido exitosamente')
      },
      onError: (err) => handleApiError(err, 'Error extendiendo contrato'),
    }
  )
}

/** Toggle step override */
export function useStepOverride(studentId: string) {
  const qc = useQueryClient()
  return useMutation(
    (body: { step: string; completado: boolean; fechaCompletado?: string }) =>
      api.post(`/api/postgres/students/${encodeURIComponent(studentId)}/step-override`, body),
    {
      onSuccess: () => {
        qc.invalidateQueries(keys.profile(studentId))
        toast.success('Override actualizado')
      },
      onError: (err) => handleApiError(err, 'Error actualizando override'),
    }
  )
}
