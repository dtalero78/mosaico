import 'server-only'
import { handler, successResponse } from '@/lib/api-helpers'
import { queryOne, queryMany } from '@/lib/postgres'

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) { console.error(e); return fallback }
}

const STEP_EXTRACT = `
  CAST(
    NULLIF(
      REGEXP_REPLACE(
        COALESCE("nombreEvento", "step", ''),
        '^.*[Ss]tep\\s+([0-9]+).*$',
        '\\1'
      ),
      COALESCE("nombreEvento", "step", '')
    ) AS INTEGER
  )
`

export const GET = handler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const startDate  = searchParams.get('startDate')  || '2020-01-01'
  const endDate    = searchParams.get('endDate')    || '2030-12-31'
  const plataforma = searchParams.get('plataforma') || ''
  const nivel      = searchParams.get('nivel')      || ''

  const params = [startDate, endDate, plataforma, nivel]

  const baseWhere = `
    "fechaEvento" >= $1::date
    AND "fechaEvento" <= $2::date
    AND ($3 = '' OR "plataforma" = $3)
    AND ($4 = '' OR "nivel" = $4)
    AND COALESCE("tipo", "tipoEvento") = 'SESSION'
    AND COALESCE("nombreEvento", "step", '') ~* 'step\\s+[0-9]+'
    AND ${STEP_EXTRACT} BETWEEN 1 AND 45
    AND "nivel" NOT ILIKE '%JUMP%'
    AND COALESCE("nivel", '') != 'WELCOME'
    AND COALESCE("nivel", '') != 'DONE'
    AND COALESCE("nivel", '') != 'ESS'
    AND ${STEP_EXTRACT} % 5 = 0
    AND NOT EXISTS (
      SELECT 1 FROM "PEOPLE" pp_prb
      WHERE pp_prb."numeroId" = "ACADEMICA_BOOKINGS"."numeroId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )
  `

  const [jumps, plataformas, niveles] = await Promise.all([

    safeQuery(() => queryOne<any>(`
      SELECT
        COUNT(*)::int                                                                              AS total,
        COALESCE(SUM(CASE WHEN "asistencia" = true OR "asistio" = true THEN 1 ELSE 0 END), 0)::int  AS asistieron,
        COALESCE(SUM(CASE WHEN "cancelo" = true THEN 1 ELSE 0 END), 0)::int                        AS cancelaron,
        COALESCE(SUM(CASE WHEN "noAprobo" = true THEN 1 ELSE 0 END), 0)::int                       AS "noAprobaron",
        COALESCE(SUM(CASE WHEN
          ("asistencia" = true OR "asistio" = true)
          AND ("noAprobo" IS DISTINCT FROM true)
        THEN 1 ELSE 0 END), 0)::int                                                                AS aprobaron
      FROM "ACADEMICA_BOOKINGS"
      WHERE ${baseWhere}
    `, params), { total: 0, asistieron: 0, cancelaron: 0, noAprobaron: 0, aprobaron: 0 }),

    safeQuery(() => queryMany<{ plataforma: string }>(
      `SELECT DISTINCT "plataforma"
       FROM "ACADEMICA_BOOKINGS"
       WHERE "plataforma" IS NOT NULL AND "plataforma" != ''
       ORDER BY "plataforma"`, []
    ), []),

    safeQuery(() => queryMany<{ nivel: string }>(
      `SELECT nivel FROM (
         SELECT DISTINCT "nivel" AS nivel
         FROM "ACADEMICA_BOOKINGS"
         WHERE "nivel" IS NOT NULL AND "nivel" != ''
           AND "nivel" NOT ILIKE '%JUMP%'
           AND "nivel" != 'WELCOME'
           AND "nivel" != 'DONE'
           AND "nivel" != 'ESS'
       ) sub
       ORDER BY CASE nivel
         WHEN 'BN1' THEN 1 WHEN 'BN2' THEN 2 WHEN 'BN3' THEN 3
         WHEN 'P1'  THEN 4 WHEN 'P2'  THEN 5 WHEN 'P3'  THEN 6
         WHEN 'F1'  THEN 7 WHEN 'F2'  THEN 8 WHEN 'F3'  THEN 9
         ELSE 99
       END`, []
    ), []),
  ])

  return successResponse({
    jumps,
    plataformas: plataformas.map((r: any) => r.plataforma),
    niveles: niveles.map((r: any) => r.nivel),
  })
})
