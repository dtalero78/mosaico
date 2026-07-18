/**
 * Dashboard Service
 *
 * Aggregated statistics for the main dashboard.
 * Runs queries in parallel for performance + cache server 60s.
 *
 * Optimizaciones aplicadas (2026-06-09):
 *  - Eliminado `topStudents` del payload — el dashboard UI ya no lo muestra
 *    (~500ms ahorrados por carga).
 *  - Cache module-level con TTL 60s para getStats() y getMonthlyAggregates().
 *    El polling del dashboard (5min staleTime client) hace cientos de hits
 *    redundantes entre instancias; el cache absorbe ~95%.
 */

import 'server-only';
import { PeopleRepository } from '@/repositories/people.repository';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { queryMany, queryOne } from '@/lib/postgres';

// ── Cache module-level (vive entre requests dentro de la misma instancia) ──

const STATS_TTL_MS    = 60 * 1000;   // 60s — agregados del día, stale aceptable
const MONTHLY_TTL_MS  = 60 * 1000;   // 60s — agregados del mes

let statsCache:   { value: any; expires: number } | null = null;
let monthlyCache: { value: any; expires: number } | null = null;

/**
 * Get all dashboard statistics.
 * Cached 60s per instance — el polling del UI lee de cache la mayoría del tiempo.
 */
export async function getStats() {
  const now = Date.now();
  if (statsCache && statsCache.expires > now) return statsCache.value;

  const nowDate = new Date();
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).toISOString();
  const todayEnd = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 23, 59, 59).toISOString();

  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    eventsToday,
    enrollmentsToday,
    uniqueAdvisorsToday,
  ] = await Promise.all([
    AcademicaRepository.countTotal(),
    PeopleRepository.countActive(),
    PeopleRepository.countInactive(),
    CalendarioRepository.countEventsInRange(todayStart, todayEnd),
    BookingRepository.countEnrollmentsInRange(todayStart, todayEnd),
    CalendarioRepository.countUniqueAdvisorsInRange(todayStart, todayEnd),
  ]);

  const value = {
    totalUsers,
    activeUsers,
    inactiveUsers,
    eventsToday,
    enrollmentsToday,
    uniqueAdvisorsToday,
  };
  statsCache = { value, expires: now + STATS_TTL_MS };
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyDonut { asistieron: number; canceladas: number; noAsistieron: number }
export interface MonthlyNivelPoint { nivel: string; total: number }
export interface MonthlyAggregates {
  donut: MonthlyDonut
  porNivel: MonthlyNivelPoint[]
  monthLabel: string
}

/**
 * Agregaciones globales del mes corriente para el dashboard admin.
 * 2 queries paralelas sobre ACADEMICA_BOOKINGS JOIN CALENDARIO.
 *
 * - donut:   3 buckets disjuntos (asistieron / canceladas / noAsistieron-pasadas)
 * - porNivel: bookings no cancelados agrupados por nivel del evento
 *
 * El heatmap Día×Hora se eliminó (2026-06-09) — eliminado del UI por decisión
 * operativa y aprovechamos para quitar la query pesada (GROUP BY weekday × hour
 * sobre todos los bookings del mes) que sumaba carga a la BD.
 *
 * Nota perf: el JOIN usa `b."eventoId" = c."_id" OR b."idEvento" = c."_id"`
 * en vez de COALESCE para que Postgres use BitmapOr sobre los índices
 * idx_bookings_evento + idx_bookings_idevento (mismo fix aplicado en
 * advisor-event-log.service para evitar Seq Scan).
 */
export async function getMonthlyAggregates(_tz: string = 'America/Bogota'): Promise<MonthlyAggregates> {
  const nowMs = Date.now();
  if (monthlyCache && monthlyCache.expires > nowMs) return monthlyCache.value;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
  const nextMonth  = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)).toISOString();
  const monthLabel = now.toLocaleDateString('es', { month: 'long', year: 'numeric' });

  const [donut, porNivel] = await Promise.all([
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

  const value = {
    donut: donut ?? { asistieron: 0, canceladas: 0, noAsistieron: 0 },
    porNivel,
    monthLabel,
  };
  monthlyCache = { value, expires: nowMs + MONTHLY_TTL_MS };
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen de campañas + usuarios activos/inactivos + cursos activos por tipo.
// Alimenta el bloque "Campañas y cursos" del dashboard admin.

import { ordenTipoCurso } from '@/lib/cursos-campaign';

export interface CampaniaResumen {
  campaign: string;
  cursos: number;
  inscritos: number;
  cupos: number;
  cierreMatricula: string | null; // finalCampaign (YYYY-MM-DD)
  finalCursoMax: string | null;
}
export interface CursoTipoActivo { tipo: string; cursos: number; inscritos: number }
export interface CampaniasResumen {
  enMatricula: CampaniaResumen[];
  activas: CampaniaResumen[];
  cerradas: CampaniaResumen[];
  usuarios: { activos: number; inactivos: number };
  cursosActivosPorTipo: CursoTipoActivo[];
  totalCursosActivos: number;
}

const CAMPANIAS_TTL_MS = 60 * 1000;
let campaniasCache: { value: CampaniasResumen; expires: number } | null = null;

/** Estado de una campaña por sus fechas (mismo criterio que Consulta de Cursos). */
function estadoCampania(cierreMatricula: string | null, finalCursoMax: string | null, hoy: string): 'matricula' | 'activo' | 'cerrado' {
  const fc = (finalCursoMax || '').slice(0, 10);
  const fcamp = (cierreMatricula || '').slice(0, 10);
  if (fc && fc < hoy) return 'cerrado';        // el curso ya terminó
  if (fcamp && fcamp >= hoy) return 'matricula'; // matrícula aún abierta
  return 'activo';
}

export async function getCampaniasResumen(tz: string = 'America/Bogota'): Promise<CampaniasResumen> {
  const nowMs = Date.now();
  if (campaniasCache && campaniasCache.expires > nowMs) return campaniasCache.value;

  // "Hoy" en la zona horaria pedida, en formato YYYY-MM-DD (comparación con DATE).
  let hoy: string;
  try { hoy = new Date().toLocaleDateString('en-CA', { timeZone: tz }); }
  catch { hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); }

  const [campRows, cursosRows, userRow] = await Promise.all([
    // Campañas agregadas (una fila por campaña).
    queryMany<any>(
      `SELECT "campaign",
              MAX("finalCampaign"::text)          AS "cierreMatricula",
              MAX("finalCurso"::text)             AS "finalCursoMax",
              COUNT(*)::int                        AS "cursos",
              SUM(COALESCE("usuInscritos",0))::int AS "inscritos",
              SUM(COALESCE("numeroUsuarios",0))::int AS "cupos"
         FROM "CURSOS_CAMPAIGN"
        WHERE "campaign" IS NOT NULL
        GROUP BY "campaign"`,
      [],
    ),
    // Cursos activos (finalCurso >= hoy) por tipo.
    queryMany<any>(
      `SELECT "tipoCurso" AS "tipo", COUNT(*)::int AS "cursos", SUM(COALESCE("usuInscritos",0))::int AS "inscritos"
         FROM "CURSOS_CAMPAIGN"
        WHERE "finalCurso"::text >= $1
        GROUP BY "tipoCurso"`,
      [hoy],
    ),
    // Usuarios (beneficiarios) activos/inactivos, excluyendo pruebas.
    queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE "estadoInactivo" IS NOT TRUE)::int AS "activos",
              COUNT(*) FILTER (WHERE "estadoInactivo" = true)::int      AS "inactivos"
         FROM "PEOPLE"
        WHERE "tipoUsuario" = 'BENEFICIARIO' AND ("contrato" IS NULL OR "contrato" NOT LIKE 'PRB-%')`,
    ),
  ]);

  const mapCamp = (r: any): CampaniaResumen => ({
    campaign: r.campaign,
    cursos: r.cursos,
    inscritos: r.inscritos,
    cupos: r.cupos,
    cierreMatricula: r.cierreMatricula ? r.cierreMatricula.slice(0, 10) : null,
    finalCursoMax: r.finalCursoMax ? r.finalCursoMax.slice(0, 10) : null,
  });

  const enMatricula: CampaniaResumen[] = [];
  const activas: CampaniaResumen[] = [];
  const cerradas: CampaniaResumen[] = [];
  for (const r of campRows) {
    const c = mapCamp(r);
    const est = estadoCampania(c.cierreMatricula, c.finalCursoMax, hoy);
    if (est === 'matricula') enMatricula.push(c);
    else if (est === 'activo') activas.push(c);
    else cerradas.push(c);
  }
  // Más próximas primero por cierre de matrícula.
  const byCierreDesc = (a: CampaniaResumen, b: CampaniaResumen) => (b.cierreMatricula || '').localeCompare(a.cierreMatricula || '');
  enMatricula.sort(byCierreDesc); activas.sort(byCierreDesc); cerradas.sort(byCierreDesc);

  const cursosActivosPorTipo: CursoTipoActivo[] = (cursosRows || [])
    .map((r: any) => ({ tipo: r.tipo, cursos: r.cursos, inscritos: r.inscritos }))
    .sort((a, b) => ordenTipoCurso(a.tipo) - ordenTipoCurso(b.tipo));
  const totalCursosActivos = cursosActivosPorTipo.reduce((n, t) => n + t.cursos, 0);

  const value: CampaniasResumen = {
    enMatricula, activas, cerradas,
    usuarios: { activos: userRow?.activos ?? 0, inactivos: userRow?.inactivos ?? 0 },
    cursosActivosPorTipo,
    totalCursosActivos,
  };
  campaniasCache = { value, expires: nowMs + CAMPANIAS_TTL_MS };
  return value;
}
