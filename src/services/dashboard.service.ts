/**
 * Dashboard Service
 *
 * Aggregated statistics for the main dashboard.
 * Runs all queries in parallel for performance.
 */

import 'server-only';
import { PeopleRepository } from '@/repositories/people.repository';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { queryMany, queryOne } from '@/lib/postgres';

/**
 * Get all dashboard statistics.
 */
export async function getStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    eventsToday,
    enrollmentsToday,
    uniqueAdvisorsToday,
    topStudents,
  ] = await Promise.all([
    AcademicaRepository.countTotal(),
    PeopleRepository.countActive(),
    PeopleRepository.countInactive(),
    CalendarioRepository.countEventsInRange(todayStart, todayEnd),
    BookingRepository.countEnrollmentsInRange(todayStart, todayEnd),
    CalendarioRepository.countUniqueAdvisorsInRange(todayStart, todayEnd),
    BookingRepository.topStudentsByAttendance(monthStart, 5),
  ]);

  return {
    totalUsers,
    activeUsers,
    inactiveUsers,
    eventsToday,
    enrollmentsToday,
    uniqueAdvisorsToday,
    topStudentsThisMonth: topStudents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyHeatmapPoint { weekday: number; hour: number; total: number }
export interface MonthlyDonut { asistieron: number; canceladas: number; noAsistieron: number }
export interface MonthlyNivelPoint { nivel: string; total: number }
export interface MonthlyAggregates {
  heatmap: MonthlyHeatmapPoint[]
  donut: MonthlyDonut
  porNivel: MonthlyNivelPoint[]
  monthLabel: string
}

/**
 * Agregaciones globales del mes corriente para el dashboard admin.
 * 3 queries paralelas sobre ACADEMICA_BOOKINGS JOIN CALENDARIO.
 *
 * - heatmap: bookings agrupados por weekday (0=Lun, 6=Dom) × hora (06-21)
 * - donut:   3 buckets disjuntos (asistieron / canceladas / noAsistieron-pasadas)
 * - porNivel: bookings no cancelados agrupados por nivel del evento
 *
 * Nota perf: el JOIN usa `b."eventoId" = c."_id" OR b."idEvento" = c."_id"`
 * en vez de COALESCE para que Postgres use BitmapOr sobre los índices
 * idx_bookings_evento + idx_bookings_idevento (mismo fix aplicado en
 * advisor-event-log.service para evitar Seq Scan).
 */
export async function getMonthlyAggregates(tz: string = 'America/Bogota'): Promise<MonthlyAggregates> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
  const nextMonth  = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)).toISOString();
  const monthLabel = now.toLocaleDateString('es', { month: 'long', year: 'numeric' });

  const [heatmap, donut, porNivel] = await Promise.all([
    queryMany<MonthlyHeatmapPoint>(
      `SELECT
         (((EXTRACT(DOW FROM c."dia" AT TIME ZONE $3))::int + 6) % 7) AS "weekday",
         (EXTRACT(HOUR FROM c."dia" AT TIME ZONE $3))::int            AS "hour",
         COUNT(*)::int                                                  AS "total"
       FROM "CALENDARIO" c
       JOIN "ACADEMICA_BOOKINGS" b
         ON (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
       WHERE c."dia" >= $1::timestamptz
         AND c."dia" <  $2::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM "PEOPLE" pp_prb
           WHERE pp_prb."numeroId" = b."numeroId"
             AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
         )
       GROUP BY "weekday", "hour"`,
      [monthStart, nextMonth, tz],
    ),
    queryOne<MonthlyDonut>(
      `SELECT
         COUNT(*) FILTER (WHERE b."cancelo" IS NOT TRUE AND b."asistio" = true)::int  AS "asistieron",
         COUNT(*) FILTER (WHERE b."cancelo" = true)::int                                AS "canceladas",
         COUNT(*) FILTER (
           WHERE b."cancelo" IS NOT TRUE
             AND b."asistio" IS NOT TRUE
             AND c."dia" < NOW()
         )::int                                                                          AS "noAsistieron"
       FROM "CALENDARIO" c
       JOIN "ACADEMICA_BOOKINGS" b
         ON (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
       WHERE c."dia" >= $1::timestamptz AND c."dia" < $2::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM "PEOPLE" pp_prb
           WHERE pp_prb."numeroId" = b."numeroId"
             AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
         )`,
      [monthStart, nextMonth],
    ),
    queryMany<MonthlyNivelPoint>(
      `SELECT
         COALESCE(NULLIF(c."nivel", ''), NULLIF(b."nivel", ''), 'Sin nivel') AS "nivel",
         COUNT(*)::int                                                        AS "total"
       FROM "CALENDARIO" c
       JOIN "ACADEMICA_BOOKINGS" b
         ON (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
       WHERE c."dia" >= $1::timestamptz
         AND c."dia" <  $2::timestamptz
         AND b."cancelo" IS NOT TRUE
         AND NOT EXISTS (
           SELECT 1 FROM "PEOPLE" pp_prb
           WHERE pp_prb."numeroId" = b."numeroId"
             AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
         )
       GROUP BY 1
       ORDER BY 2 DESC`,
      [monthStart, nextMonth],
    ),
  ]);

  return {
    heatmap,
    donut: donut ?? { asistieron: 0, canceladas: 0, noAsistieron: 0 },
    porNivel,
    monthLabel,
  };
}
