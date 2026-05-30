import 'server-only'
import { handler, successResponse } from '@/lib/api-helpers'
import { queryOne, queryMany } from '@/lib/postgres'

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) { console.error(e); return fallback }
}

export const GET = handler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const startDate  = searchParams.get('startDate')  || '2020-01-01'
  const endDate    = searchParams.get('endDate')    || '2030-12-31'
  const plataforma = searchParams.get('plataforma') || ''

  const params = [startDate, endDate, plataforma]

  const baseWhere = `
    "fechaEvento" >= $1::date
    AND "fechaEvento" <= $2::date
    AND ($3 = '' OR "plataforma" = $3)
    AND COALESCE("tipo", "tipoEvento") = 'SESSION'
    AND COALESCE("nivel", '') = 'WELCOME'
    AND NOT EXISTS (
      SELECT 1 FROM "PEOPLE" pp_prb
      WHERE pp_prb."numeroId" = "ACADEMICA_BOOKINGS"."numeroId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )
  `

  const [sesiones, plataformas] = await Promise.all([

    safeQuery(() => queryOne<any>(`
      SELECT
        COUNT(*)::int                                                                              AS total,
        COALESCE(SUM(CASE WHEN "asistencia" = true OR "asistio" = true THEN 1 ELSE 0 END), 0)::int  AS asistieron,
        COALESCE(SUM(CASE WHEN "cancelo" = true THEN 1 ELSE 0 END), 0)::int                        AS cancelaron,
        COALESCE(SUM(CASE WHEN
          ("asistencia" IS DISTINCT FROM true AND "asistio" IS DISTINCT FROM true)
          AND "cancelo" IS DISTINCT FROM true
        THEN 1 ELSE 0 END), 0)::int                                                                AS "noAsistieron"
      FROM "ACADEMICA_BOOKINGS"
      WHERE ${baseWhere}
    `, params), { total: 0, asistieron: 0, cancelaron: 0, noAsistieron: 0 }),

    safeQuery(() => queryMany<{ plataforma: string }>(
      `SELECT DISTINCT "plataforma"
       FROM "ACADEMICA_BOOKINGS"
       WHERE "plataforma" IS NOT NULL AND "plataforma" != ''
       ORDER BY "plataforma"`, []
    ), []),
  ])

  return successResponse({ sesiones, plataformas: plataformas.map((r: any) => r.plataforma) })
})
