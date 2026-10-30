'use client'

import toast from 'react-hot-toast'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(
      body.error || `HTTP ${response.status}`,
      response.status,
      body.details
    )
  }

  // Handle CSV/blob responses
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/csv')) {
    return response.text() as unknown as T
  }

  return response.json()
}

export const api = {
  get: <T = any>(url: string) => apiFetch<T>(url),

  post: <T = any>(url: string, body?: any) =>
    apiFetch<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),

  put: <T = any>(url: string, body?: any) =>
    apiFetch<T>(url, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),

  patch: <T = any>(url: string, body?: any) =>
    apiFetch<T>(url, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),

  delete: <T = any>(url: string, body?: any) =>
    apiFetch<T>(url, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
}

/**
 * Show error toast from ApiError or generic Error
 */
export function handleApiError(error: unknown, fallbackMessage = 'Error inesperado') {
  if (error instanceof ApiError) {
    // details puede venir como objeto (p.ej. {status, message} de WhatsApp): React no lo pinta.
    const d: any = error.details
    const texto = typeof d === 'string' ? d : d && typeof d === 'object' ? (d.message || d.error || '') : ''
    toast.error(String(texto || error.message))
  } else if (error instanceof Error) {
    toast.error(error.message || fallbackMessage)
  } else {
    toast.error(fallbackMessage)
  }
}
