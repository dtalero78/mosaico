'use client'

import { useQuery } from 'react-query'
import { api } from './use-api'

// ─── Query Keys ───
const keys = {
  all: (includeInactive?: boolean) => ['advisors', { includeInactive }] as const,
  byId: (id: string) => ['advisors', id] as const,
  stats: (id: string) => ['advisors', id, 'stats'] as const,
  events: (id: string, filters?: Record<string, any>) => ['advisors', id, 'events', filters] as const,
  name: (id: string) => ['advisors', id, 'name'] as const,
}

// ─── Queries ───

/** Fetch all advisors */
export function useAdvisors(includeInactive = false) {
  return useQuery(
    keys.all(includeInactive),
    () => api.get(`/api/postgres/guias${includeInactive ? '?includeInactive=true' : ''}`),
    { staleTime: 5 * 60 * 1000 }
  )
}

/** Fetch advisor stats (class count, attendance, etc.) */
export function useAdvisorStats(advisorId: string | undefined) {
  return useQuery(
    keys.stats(advisorId!),
    () => api.get(`/api/postgres/guias/${encodeURIComponent(advisorId!)}/stats`),
    { enabled: !!advisorId, staleTime: 5 * 60 * 1000 }
  )
}

/** Fetch events for a specific advisor */
export function useAdvisorEvents(advisorId: string | undefined, filters?: { startDate?: string; endDate?: string; tipo?: string }) {
  const params = new URLSearchParams()
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
  }
  const qs = params.toString()
  return useQuery(
    keys.events(advisorId!, filters),
    () => api.get(`/api/postgres/guias/${encodeURIComponent(advisorId!)}/events${qs ? `?${qs}` : ''}`),
    { enabled: !!advisorId }
  )
}

/** Fetch advisor display name by ID */
export function useAdvisorName(advisorId: string | undefined) {
  return useQuery(
    keys.name(advisorId!),
    () => api.get(`/api/postgres/guias/${encodeURIComponent(advisorId!)}/name`),
    { enabled: !!advisorId, staleTime: 30 * 60 * 1000 }
  )
}

/**
 * Utility to build an advisor name map from the advisors list response.
 * Usage: const { data } = useAdvisors(); const nameMap = buildAdvisorNameMap(data?.advisors);
 */
export function buildAdvisorNameMap(advisors: any[] | undefined): Record<string, string> {
  if (!advisors) return {}
  const map: Record<string, string> = {}
  for (const a of advisors) {
    const name = a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim()
    if (a._id && name) map[a._id] = name
  }
  return map
}
