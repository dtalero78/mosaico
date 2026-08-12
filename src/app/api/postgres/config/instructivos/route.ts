/**
 * GET /api/postgres/config/instructivos
 * Retorna la lista de instructivos desde APP_CONFIG (accesible a cualquier usuario autenticado)
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryOne } from '@/lib/postgres'

const CONFIG_KEY = 'instructivos_config'

const DEFAULT_INSTRUCTIVOS: { id: number; title: string; description: string; videoKey: string | null }[] = []

export const GET = handlerWithAuth(async () => {
  const row = await queryOne<{ value: string }>(
    `SELECT "value" FROM "APP_CONFIG" WHERE "key" = $1`,
    [CONFIG_KEY]
  )
  let instructivos = DEFAULT_INSTRUCTIVOS
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value)
      if (Array.isArray(parsed)) instructivos = parsed
    } catch { /* use default */ }
  }
  return successResponse({ instructivos })
})
