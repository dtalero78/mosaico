import 'server-only'
import { handler, successResponse } from '@/lib/api-helpers'
import { queryMany } from '@/lib/postgres'

async function safeQuery<T>(fn: () => Promise<T[]>, fallback: T[] = []): Promise<T[]> {
  try { return await fn() } catch (e) { console.error(e); return fallback }
}

// ISO dow 1=Lun … 7=Dom para "esta semana" en UTC
function currentWeekRange(): { weekStart: string; weekEnd: string } {
  const now  = new Date()
  const dow  = now.getUTCDay()          // 0=Dom … 6=Sáb
  const diff = (dow === 0 ? -6 : 1 - dow)
  const mon  = new Date(now)
  mon.setUTCDate(now.getUTCDate() + diff)
  mon.setUTCHours(0, 0, 0, 0)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  sun.setUTCHours(23, 59, 59, 999)
  return {
    weekStart: mon.toISOString().split('T')[0],
    weekEnd:   sun.toISOString().split('T')[0],
  }
}

export const GET = handler(async (req) => {
  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('startDate') || '2020-01-01'
  const endDate   = searchParams.get('endDate')   || '2030-12-31'
  const nivel     = searchParams.get('nivel')     || null   // optional filter

  const { weekStart, weekEnd } = currentWeekRange()

  const nivelFilter = nivel ? `AND COALESCE(c."nivel", b."nivel") = '${nivel.replace(/'/g, "''")}'` : ''

  // Base WHERE para el período filtrado — excluye WELCOME, cancelos, sin fecha
  // agendamiento, y contratos de prueba (PRB-).
  const baseWhere = `
    b."fechaAgendamiento" IS NOT NULL
    AND b."fechaAgendamiento" >= $1::date
    AND b."fechaAgendamiento" < ($2::date + INTERVAL '1 day')
    AND (b."cancelo" IS NULL OR b."cancelo" = false)
    AND b."origen" IN ('PANEL_EST','POSTGRES','COMP')
    AND COALESCE(c."nivel", b."nivel", '') NOT IN ('WELCOME','')
    AND NOT EXISTS (
      SELECT 1 FROM "PEOPLE" pp_prb
      WHERE pp_prb."numeroId" = b."numeroId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )
    ${nivelFilter}
    LEFT_JOIN_PLACEHOLDER
  `
  // JOIN CALENDARIO para usar nivel/step/tipo reales del evento
  const joinStr = `LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")`

  const buildWhere = (extra = '') =>
    baseWhere.replace('LEFT_JOIN_PLACEHOLDER', extra)

  const params = [startDate, endDate]

  const [
    sesionesPorNivel,
    sesionesPorDia,
    jumpsPorNivel,
    clubesPorTipo,
    // Semana actual
    sesionesSemana,
    jumpsSemana,
    clubesSemana,
  ] = await Promise.all([

    // ── Sesiones (SESSION) por nivel en el período ──
    safeQuery(() => queryMany(`
      SELECT
        COALESCE(c."nivel", b."nivel") AS nivel,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE ${buildWhere()}
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento", '') NOT IN ('COMPLEMENTARIA')
        AND (
          COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'SESSION'
          OR (
            COALESCE(c."tipo", b."tipo", b."tipoEvento") IS NULL
            AND COALESCE(c."step", b."step", '') ~ '^Step [0-9]'
            AND COALESCE(c."step", b."step", '') NOT LIKE 'TRAINING%'
          )
        )
      GROUP BY 1
      ORDER BY 1
    `, params)),

    // ── Sesiones por día de la semana (ISO 1=Lun) en el período ──
    safeQuery(() => queryMany(`
      SELECT
        EXTRACT(ISODOW FROM b."fechaAgendamiento")::int AS dow,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE ${buildWhere()}
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'SESSION'
      GROUP BY 1
      ORDER BY 1
    `, params)),

    // ── Jumps (SESSION múltiplo de 5) por nivel en el período ──
    safeQuery(() => queryMany(`
      SELECT
        COALESCE(c."nivel", b."nivel") AS nivel,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE ${buildWhere()}
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento", 'SESSION') = 'SESSION'
        AND (
          (COALESCE(c."step", b."step") ~ '^Step [0-9]' AND
           (COALESCE(c."step", b."step") ~ '^Step (5|10|15|20|25|30|35|40|45)$'))
        )
      GROUP BY 1
      ORDER BY 1
    `, params)),

    // ── Clubes por tipo en el período ──
    safeQuery(() => queryMany(`
      SELECT
        CASE
          WHEN COALESCE(c."step", b."step", '') LIKE 'TRAINING%'    THEN 'TRAINING'
          WHEN COALESCE(c."step", b."step", '') LIKE 'GRAMMAR%'      THEN 'GRAMMAR'
          WHEN COALESCE(c."step", b."step", '') LIKE 'PRONUNCIATION%' THEN 'PRONUNCIATION'
          WHEN COALESCE(c."step", b."step", '') LIKE 'LISTENING%'    THEN 'LISTENING'
          WHEN COALESCE(c."step", b."step", '') LIKE 'KARAOKE%'      THEN 'KARAOKE'
          WHEN COALESCE(c."step", b."step", '') LIKE 'CONVERSATION%' THEN 'CONVERSATION'
          ELSE 'OTRO'
        END AS tipo_club,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE ${buildWhere()}
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'CLUB'
      GROUP BY 1
      ORDER BY 2 DESC
    `, params)),

    // ── Sesiones semana actual ──
    safeQuery(() => queryMany(`
      SELECT
        COALESCE(c."nivel", b."nivel") AS nivel,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE b."fechaAgendamiento" IS NOT NULL
        AND b."fechaAgendamiento" >= $1::date
        AND b."fechaAgendamiento" < ($2::date + INTERVAL '1 day')
        AND (b."cancelo" IS NULL OR b."cancelo" = false)
        AND b."origen" IN ('PANEL_EST','POSTGRES','COMP')
        AND COALESCE(c."nivel", b."nivel", '') NOT IN ('WELCOME','')
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'SESSION'
        ${nivelFilter}
      GROUP BY 1
      ORDER BY 1
    `, [weekStart, weekEnd])),

    // ── Jumps semana actual ──
    safeQuery(() => queryMany(`
      SELECT
        COALESCE(c."nivel", b."nivel") AS nivel,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE b."fechaAgendamiento" IS NOT NULL
        AND b."fechaAgendamiento" >= $1::date
        AND b."fechaAgendamiento" < ($2::date + INTERVAL '1 day')
        AND (b."cancelo" IS NULL OR b."cancelo" = false)
        AND b."origen" IN ('PANEL_EST','POSTGRES','COMP')
        AND COALESCE(c."nivel", b."nivel", '') NOT IN ('WELCOME','')
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento", 'SESSION') = 'SESSION'
        AND (COALESCE(c."step", b."step") ~ '^Step (5|10|15|20|25|30|35|40|45)$')
        ${nivelFilter}
      GROUP BY 1
      ORDER BY 1
    `, [weekStart, weekEnd])),

    // ── Clubes semana actual ──
    safeQuery(() => queryMany(`
      SELECT
        CASE
          WHEN COALESCE(c."step", b."step", '') LIKE 'TRAINING%'     THEN 'TRAINING'
          WHEN COALESCE(c."step", b."step", '') LIKE 'GRAMMAR%'       THEN 'GRAMMAR'
          WHEN COALESCE(c."step", b."step", '') LIKE 'PRONUNCIATION%' THEN 'PRONUNCIATION'
          WHEN COALESCE(c."step", b."step", '') LIKE 'LISTENING%'     THEN 'LISTENING'
          WHEN COALESCE(c."step", b."step", '') LIKE 'KARAOKE%'       THEN 'KARAOKE'
          WHEN COALESCE(c."step", b."step", '') LIKE 'CONVERSATION%'  THEN 'CONVERSATION'
          ELSE 'OTRO'
        END AS tipo_club,
        COUNT(*)::int AS total
      FROM "ACADEMICA_BOOKINGS" b
      ${joinStr}
      WHERE b."fechaAgendamiento" IS NOT NULL
        AND b."fechaAgendamiento" >= $1::date
        AND b."fechaAgendamiento" < ($2::date + INTERVAL '1 day')
        AND (b."cancelo" IS NULL OR b."cancelo" = false)
        AND b."origen" IN ('PANEL_EST','POSTGRES','COMP')
        AND COALESCE(c."nivel", b."nivel", '') NOT IN ('WELCOME','')
        AND COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'CLUB'
        ${nivelFilter}
      GROUP BY 1
      ORDER BY 2 DESC
    `, [weekStart, weekEnd])),
  ])

  return successResponse({
    sesionesPorNivel,
    sesionesPorDia,
    jumpsPorNivel,
    clubesPorTipo,
    sesionesSemana,
    jumpsSemana,
    clubesSemana,
    weekStart,
    weekEnd,
  })
})
