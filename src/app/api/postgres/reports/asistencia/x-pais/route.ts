import 'server-only'
import { handler, successResponse } from '@/lib/api-helpers'
import { queryMany } from '@/lib/postgres'

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) { console.error(e); return fallback }
}

const STEP_EXTRACT = `
  CAST(
    NULLIF(
      REGEXP_REPLACE(
        COALESCE(b."nombreEvento", b."step", ''),
        '^.*[Ss]tep\\s+([0-9]+).*$',
        '\\1'
      ),
      COALESCE(b."nombreEvento", b."step", '')
    ) AS INTEGER
  )
`

// Suma los totales de todas las filas por plataforma
function agg(rows: any[]) {
  return rows.reduce(
    (a, r) => ({
      total:       a.total       + (r.total       || 0),
      asistieron:  a.asistieron  + (r.asistieron  || 0),
      cancelaron:  a.cancelaron  + (r.cancelaron  || 0),
      aprobaron:   a.aprobaron   + (r.aprobaron   || 0),
      noAprobaron: a.noAprobaron + (r.noAprobaron || 0),
    }),
    { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0 }
  )
}

export const GET = handler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate') || '2020-01-01'
  const endDate   = searchParams.get('endDate')   || '2030-12-31'
  const p = [startDate, endDate]

  const dateWhere = `
    "fechaEvento" >= $1::date
    AND "fechaEvento" < ($2::date + INTERVAL '1 day')
  `

  // JOIN ACADEMICA to resolve plataforma when booking.plataforma is null
  const BASE_SELECT = `
    SELECT
      COALESCE(b."plataforma", a."plataforma", 'Sin plataforma') AS plataforma,
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN b."asistencia" = true OR b."asistio" = true THEN 1 ELSE 0 END), 0)::int AS asistieron,
      COALESCE(SUM(CASE WHEN b."cancelo" = true THEN 1 ELSE 0 END), 0)::int AS cancelaron
    FROM "ACADEMICA_BOOKINGS" b
    LEFT JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."studentId", b."idEstudiante")
  `

  const [sesPorPlat, jmpPorPlat, trPorPlat, clPorPlat, welPorPlat, compPorPlat] = await Promise.all([

    // ── SESIONES: SESSION + step 0-45 excluyendo múltiplos de 5 ──────────
    safeQuery(() => queryMany<any>(`
      ${BASE_SELECT}
      WHERE b."fechaEvento" >= $1::date AND b."fechaEvento" < ($2::date + INTERVAL '1 day')
        AND COALESCE(b."tipo", b."tipoEvento") = 'SESSION'
        AND COALESCE(b."nombreEvento", b."step", '') ~* 'step\\s+[0-9]+'
        AND ${STEP_EXTRACT} BETWEEN 0 AND 45
        AND (${STEP_EXTRACT} = 0 OR ${STEP_EXTRACT} % 5 != 0)
      GROUP BY COALESCE(b."plataforma", a."plataforma", 'Sin plataforma')
      ORDER BY total DESC
    `, p), []),

    // ── JUMPS: SESSION + step múltiplo de 5 ──────────────────────────────
    safeQuery(() => queryMany<any>(`
      SELECT
        COALESCE(b."plataforma", a."plataforma", 'Sin plataforma') AS plataforma,
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN b."asistencia" = true OR b."asistio" = true THEN 1 ELSE 0 END), 0)::int AS asistieron,
        COALESCE(SUM(CASE WHEN b."cancelo" = true THEN 1 ELSE 0 END), 0)::int AS cancelaron,
        COALESCE(SUM(CASE WHEN
          (b."asistencia" = true OR b."asistio" = true)
          AND b."participacion" = true
          AND (b."noAprobo" IS DISTINCT FROM true)
        THEN 1 ELSE 0 END), 0)::int AS aprobaron,
        COALESCE(SUM(CASE WHEN
          (b."asistencia" = true OR b."asistio" = true)
          AND b."noAprobo" = true
        THEN 1 ELSE 0 END), 0)::int AS "noAprobaron"
      FROM "ACADEMICA_BOOKINGS" b
      LEFT JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."studentId", b."idEstudiante")
      WHERE b."fechaEvento" >= $1::date AND b."fechaEvento" < ($2::date + INTERVAL '1 day')
        AND COALESCE(b."tipo", b."tipoEvento") = 'SESSION'
        AND COALESCE(b."nombreEvento", b."step", '') ~* 'step\\s+[0-9]+'
        AND ${STEP_EXTRACT} BETWEEN 1 AND 45
        AND ${STEP_EXTRACT} % 5 = 0
      GROUP BY COALESCE(b."plataforma", a."plataforma", 'Sin plataforma')
      ORDER BY total DESC
    `, p), []),

    // ── TRAINING: CLUB + nombre empieza con TRAINING…Step ────────────────
    safeQuery(() => queryMany<any>(`
      ${BASE_SELECT}
      WHERE b."fechaEvento" >= $1::date AND b."fechaEvento" < ($2::date + INTERVAL '1 day')
        AND COALESCE(b."tipo", b."tipoEvento") = 'CLUB'
        AND COALESCE(b."nombreEvento", b."step", '') ~* '^TRAINING.*Step'
      GROUP BY COALESCE(b."plataforma", a."plataforma", 'Sin plataforma')
      ORDER BY total DESC
    `, p), []),

    // ── CLUBES: CLUB + GRAMMAR/LISTENING/KARAOKE/PRONUNCIATION/CONVERSATION
    safeQuery(() => queryMany<any>(`
      ${BASE_SELECT}
      WHERE b."fechaEvento" >= $1::date AND b."fechaEvento" < ($2::date + INTERVAL '1 day')
        AND COALESCE(b."tipo", b."tipoEvento") = 'CLUB'
        AND COALESCE(b."nombreEvento", b."step", '') ~* '^(GRAMMAR|LISTENING|KARAOKE|PRONUNCIATION|CONVERSATION).*Step'
      GROUP BY COALESCE(b."plataforma", a."plataforma", 'Sin plataforma')
      ORDER BY total DESC
    `, p), []),

    // ── WELCOME: nivel = WELCOME ──────────────────────────────────────────
    safeQuery(() => queryMany<any>(`
      ${BASE_SELECT}
      WHERE b."fechaEvento" >= $1::date AND b."fechaEvento" < ($2::date + INTERVAL '1 day')
        AND COALESCE(b."nivel", '') = 'WELCOME'
      GROUP BY COALESCE(b."plataforma", a."plataforma", 'Sin plataforma')
      ORDER BY total DESC
    `, p), []),

    // ── COMPLEMENTARIAS: tipoEvento = COMPLEMENTARIA ─────────────────────
    safeQuery(() => queryMany<any>(`
      ${BASE_SELECT}
      WHERE b."fechaEvento" >= $1::date AND b."fechaEvento" < ($2::date + INTERVAL '1 day')
        AND COALESCE(b."tipo", b."tipoEvento") = 'COMPLEMENTARIA'
      GROUP BY COALESCE(b."plataforma", a."plataforma", 'Sin plataforma')
      ORDER BY total DESC
    `, p), []),
  ])

  return successResponse({
    sesiones:        { ...agg(sesPorPlat),  porPlataforma: sesPorPlat  },
    jumps:           { ...agg(jmpPorPlat),  porPlataforma: jmpPorPlat  },
    training:        { ...agg(trPorPlat),   porPlataforma: trPorPlat   },
    clubes:          { ...agg(clPorPlat),   porPlataforma: clPorPlat   },
    welcome:         { ...agg(welPorPlat),  porPlataforma: welPorPlat  },
    complementarias: { ...agg(compPorPlat), porPlataforma: compPorPlat },
  })
})
