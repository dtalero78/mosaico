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
  const tipoClub   = searchParams.get('tipoClub')   || ''

  const params = [startDate, endDate, plataforma, nivel, tipoClub]

  // CLUBS: tipo/tipoEvento = 'CLUB' y nombre NO empieza con 'TRAINING'
  // Para datos Wix (tipo=NULL) se usa tipoEvento; para datos nuevos se usa tipo
  const where = `
    "fechaEvento" >= $1::date
    AND "fechaEvento" <= $2::date
    AND ($3 = '' OR "plataforma" = $3)
    AND ($4 = '' OR "nivel" = $4)
    AND COALESCE("nivel", '') != 'ESS'
    AND COALESCE("nivel", '') != 'WELCOME'
    AND COALESCE("nivel", '') != 'DONE'
    AND "nivel" NOT ILIKE '%JUMP%'
    AND COALESCE("tipo", "tipoEvento") = 'CLUB'
    AND COALESCE("nombreEvento", "step", '') NOT ILIKE 'TRAINING%'
    AND ($5 = '' OR COALESCE("nombreEvento", "step", '') ILIKE ($5 || '%'))
    AND NOT EXISTS (
      SELECT 1 FROM "PEOPLE" pp_prb
      WHERE pp_prb."numeroId" = "ACADEMICA_BOOKINGS"."numeroId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )
  `

  // Nombre del tipo de club: extrae el prefijo antes de " - Step"
  const TIPO_CLUB_EXPR = `
    TRIM(REGEXP_REPLACE(COALESCE("nombreEvento", "step", ''), '\\s*-\\s*[Ss]tep.*$', ''))
  `

  const [clubesTotals, clubesPorTipo, tiposClub, plataformas, niveles] = await Promise.all([

    // Totales agregados
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
      WHERE ${where}
    `, params), { total: 0, asistieron: 0, noAsistieron: 0, cancelaron: 0 }),

    // Desglose por tipo de club (para barras horizontales)
    safeQuery(() => queryMany<any>(`
      SELECT
        ${TIPO_CLUB_EXPR}                                                                           AS "tipoClub",
        COUNT(*)::int                                                                              AS total,
        COALESCE(SUM(CASE WHEN "asistencia" = true OR "asistio" = true THEN 1 ELSE 0 END), 0)::int  AS asistieron,
        COALESCE(SUM(CASE WHEN "cancelo" = true THEN 1 ELSE 0 END), 0)::int                        AS cancelaron,
        COALESCE(SUM(CASE WHEN
          ("asistencia" IS DISTINCT FROM true AND "asistio" IS DISTINCT FROM true)
          AND "cancelo" IS DISTINCT FROM true
        THEN 1 ELSE 0 END), 0)::int                                                                AS "noAsistieron"
      FROM "ACADEMICA_BOOKINGS"
      WHERE ${where}
      GROUP BY ${TIPO_CLUB_EXPR}
      ORDER BY total DESC
    `, params), []),

    // Tipos de club disponibles (para el filtro dropdown)
    safeQuery(() => queryMany<{ tipoClub: string }>(
      `SELECT DISTINCT
         TRIM(REGEXP_REPLACE(COALESCE("nombreEvento", "step", ''), '\\s*-\\s*[Ss]tep.*$', '')) AS "tipoClub"
       FROM "ACADEMICA_BOOKINGS"
       WHERE COALESCE("tipo", "tipoEvento") = 'CLUB'
         AND COALESCE("nombreEvento", "step", '') NOT ILIKE 'TRAINING%'
         AND TRIM(REGEXP_REPLACE(COALESCE("nombreEvento", "step", ''), '\\s*-\\s*[Ss]tep.*$', '')) != ''
       ORDER BY 1`, []
    ), []),

    safeQuery(() => queryMany<{ plataforma: string }>(
      `SELECT DISTINCT "plataforma" FROM "ACADEMICA_BOOKINGS"
       WHERE "plataforma" IS NOT NULL AND "plataforma" != ''
       ORDER BY "plataforma"`, []
    ), []),

    safeQuery(() => queryMany<{ nivel: string }>(
      `SELECT nivel FROM (
         SELECT DISTINCT "nivel" AS nivel FROM "ACADEMICA_BOOKINGS"
         WHERE "nivel" IS NOT NULL AND "nivel" != ''
           AND "nivel" NOT ILIKE '%JUMP%'
           AND "nivel" != 'WELCOME' AND "nivel" != 'DONE' AND "nivel" != 'ESS'
       ) sub
       ORDER BY CASE nivel
         WHEN 'BN1' THEN 1 WHEN 'BN2' THEN 2 WHEN 'BN3' THEN 3
         WHEN 'P1'  THEN 4 WHEN 'P2'  THEN 5 WHEN 'P3'  THEN 6
         WHEN 'F1'  THEN 7 WHEN 'F2'  THEN 8 WHEN 'F3'  THEN 9
         ELSE 99 END`, []
    ), []),
  ])

  return successResponse({
    clubesTotals,
    clubesPorTipo,
    tiposClub: tiposClub.map((r: any) => r.tipoClub).filter(Boolean),
    plataformas: plataformas.map((r: any) => r.plataforma),
    niveles: niveles.map((r: any) => r.nivel),
  })
})
