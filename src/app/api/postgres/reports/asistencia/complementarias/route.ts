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
  const nivel      = searchParams.get('nivel')      || ''

  const params = [startDate, endDate, plataforma, nivel]

  const where = `
    "_createdDate" >= $1::date
    AND "_createdDate" < ($2::date + INTERVAL '1 day')
    AND ($3 = '' OR "plataforma" = $3)
    AND ($4 = '' OR "nivel" = $4)
    AND NOT EXISTS (
      SELECT 1 FROM "ACADEMICA" a_prb
      JOIN "PEOPLE" pp_prb ON pp_prb."numeroId" = a_prb."numeroId"
      WHERE a_prb."_id" = "COMPLEMENTARIA_ATTEMPTS"."studentId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )
  `

  const [totals, plataformas] = await Promise.all([

    safeQuery(() => queryOne<any>(`
      SELECT
        COUNT(*)::int                                                         AS total,
        COALESCE(SUM(CASE WHEN "status" = 'PASSED'      THEN 1 ELSE 0 END), 0)::int AS passed,
        COALESCE(SUM(CASE WHEN "status" = 'FAILED'      THEN 1 ELSE 0 END), 0)::int AS failed,
        COALESCE(SUM(CASE WHEN "status" = 'IN_PROGRESS' THEN 1 ELSE 0 END), 0)::int AS "inProgress"
      FROM "COMPLEMENTARIA_ATTEMPTS"
      WHERE ${where}
    `, params), { total: 0, passed: 0, failed: 0, inProgress: 0 }),

    safeQuery(() => queryMany<{ plataforma: string }>(
      `SELECT DISTINCT "plataforma"
       FROM "COMPLEMENTARIA_ATTEMPTS"
       WHERE "plataforma" IS NOT NULL AND "plataforma" != ''
       ORDER BY "plataforma"`, []
    ), []),
  ])

  const NIVELES = ['BN1', 'BN2', 'BN3', 'P1', 'P2', 'P3', 'F1', 'F2', 'F3']

  return successResponse({
    totals,
    plataformas: plataformas.map((r: any) => r.plataforma),
    niveles: NIVELES,
  })
})
