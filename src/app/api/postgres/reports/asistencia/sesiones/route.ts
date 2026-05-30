import 'server-only'
import { handler, successResponse } from '@/lib/api-helpers'
import { queryOne, queryMany } from '@/lib/postgres'

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) { console.error(e); return fallback }
}

// Extrae el número de step del campo nombreEvento o step
// Ej: "BN2 - Step 7" → 7, "Step 10" → 10, "Step 0" → 0
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

  // Filtro base: permite steps 1-45 normales O registros de nivel ESS (Step 0).
  // Excluye contratos de prueba (PRB-) — viven solo en /admin/contratos-prueba.
  const baseWhere = `
    "fechaEvento" >= $1::date
    AND "fechaEvento" <= $2::date
    AND ($3 = '' OR "plataforma" = $3)
    AND ($4 = '' OR "nivel" = $4)
    AND COALESCE("tipo", "tipoEvento") = 'SESSION'
    AND "nivel" NOT ILIKE '%JUMP%'
    AND COALESCE("nivel", '') != 'WELCOME'
    AND COALESCE("nivel", '') != 'DONE'
    AND (
      COALESCE("nivel", '') = 'ESS'
      OR (
        COALESCE("nombreEvento", "step", '') ~* 'step\\s+[0-9]+'
        AND ${STEP_EXTRACT} BETWEEN 1 AND 45
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM "PEOPLE" pp_prb
      WHERE pp_prb."numeroId" = "ACADEMICA_BOOKINGS"."numeroId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )
  `

  // ── SESIONES: steps no múltiplos de 5 + ESS Step 0 ──────────────────
  const [sesiones, jumps, plataformas, niveles] = await Promise.all([

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
        AND (
          COALESCE("nivel", '') = 'ESS'
          OR ${STEP_EXTRACT} % 5 != 0
        )
    `, params), { total: 0, asistieron: 0, cancelaron: 0, noAsistieron: 0 }),

    // ── JUMPS: múltiplos de 5 (5,10,15...45), excluye ESS ───────────────
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
        AND COALESCE("nivel", '') != 'ESS'
        AND ${STEP_EXTRACT} % 5 = 0
    `, params), { total: 0, asistieron: 0, cancelaron: 0, noAprobaron: 0, aprobaron: 0 }),

    // ── Filtros dinámicos ─────────────────────────────────────────────────
    safeQuery(() => queryMany<{ plataforma: string }>(
      `SELECT DISTINCT "plataforma"
       FROM "ACADEMICA_BOOKINGS"
       WHERE "plataforma" IS NOT NULL AND "plataforma" != ''
       ORDER BY "plataforma"`, []
    ), []),

    safeQuery(() => queryMany<{ nivel: string }>(
      `SELECT DISTINCT "nivel"
       FROM "ACADEMICA_BOOKINGS"
       WHERE "nivel" IS NOT NULL AND "nivel" != ''
         AND "nivel" NOT ILIKE '%JUMP%'
         AND "nivel" != 'WELCOME'
         AND "nivel" != 'DONE'
       ORDER BY "nivel"`, []
    ), []),
  ])

  const NIVEL_ORDER = ['ESS','BN1','BN2','BN3','P1','P2','P3','F1','F2','F3']
  const sortedNiveles = niveles
    .map((r: any) => r.nivel as string)
    .sort((a, b) => {
      const ia = NIVEL_ORDER.indexOf(a)
      const ib = NIVEL_ORDER.indexOf(b)
      if (ia === -1 && ib === -1) return a.localeCompare(b)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

  return successResponse({
    sesiones,
    jumps,
    plataformas: plataformas.map((r: any) => r.plataforma),
    niveles: sortedNiveles,
  })
})
