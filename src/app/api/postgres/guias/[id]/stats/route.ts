import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/guias/[id]/stats
 *
 * Get statistics for a specific advisor.
 * Keeps inline SQL due to complex 4-way parallel stats aggregation.
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const { searchParams } = new URL(request.url);
  const advisorId = decodeURIComponent(params.id);

  const period = searchParams.get('period') || 'month';
  let startDate = searchParams.get('startDate');
  let endDate = searchParams.get('endDate');

  if (!startDate && !endDate) {
    const now = new Date();
    endDate = now.toISOString();
    if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString();
    } else if (period === 'month') {
      const d = new Date(now); d.setMonth(d.getMonth() - 1); startDate = d.toISOString();
    } else if (period === 'year') {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1); startDate = d.toISOString();
    }
  }

  const conditions: string[] = [`c."advisor" = $1`];
  const values: any[] = [advisorId];
  let idx = 2;

  if (startDate) { conditions.push(`c."dia" >= $${idx}::timestamp with time zone`); values.push(startDate); idx++; }
  if (endDate) { conditions.push(`c."dia" <= $${idx}::timestamp with time zone`); values.push(endDate); idx++; }

  const w = `WHERE ${conditions.join(' AND ')}`;

  const [generalR, byTypeR, byNivelR, recentR] = await Promise.all([
    query(`SELECT COUNT(DISTINCT c."_id") as "totalEventos", COUNT(DISTINCT b."_id") as "totalInscripciones",
      COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as "totalAsistencias",
      COUNT(DISTINCT CASE WHEN b."asistio" = false THEN b."_id" END) as "totalAusencias",
      COUNT(DISTINCT b."idEstudiante") as "estudiantesUnicos",
      ROUND(AVG(CASE WHEN b."asistio" = true THEN 1 ELSE 0 END)::numeric * 100, 2) as "promedioAsistencia"
      FROM "CALENDARIO" c LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento" ${w}`, values),
    query(`SELECT COALESCE(c."tipo", c."evento") as "tipo", COUNT(DISTINCT c."_id") as "totalEventos", COUNT(DISTINCT b."_id") as "totalInscripciones",
      COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as "totalAsistencias"
      FROM "CALENDARIO" c LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento" ${w}
      GROUP BY COALESCE(c."tipo", c."evento") ORDER BY "totalEventos" DESC`, values),
    query(`SELECT COALESCE(c."nivel", c."tituloONivel") as "nivel", COUNT(DISTINCT c."_id") as "totalEventos", COUNT(DISTINCT b."_id") as "totalInscripciones",
      COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as "totalAsistencias"
      FROM "CALENDARIO" c LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento" ${w} AND COALESCE(c."nivel", c."tituloONivel") IS NOT NULL
      GROUP BY COALESCE(c."nivel", c."tituloONivel") ORDER BY "totalEventos" DESC`, values),
    query(`SELECT c."_id", c."dia", c."hora", c."tipo", c."nivel", c."step", c."titulo", c."inscritos",
      COUNT(DISTINCT b."_id") as "bookingCount", COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as "asistenciasCount"
      FROM "CALENDARIO" c LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento" ${w}
      GROUP BY c."_id" ORDER BY c."dia" DESC LIMIT 5`, values),
  ]);

  const g = generalR.rows[0] || {};

  return successResponse({
    advisor: advisorId,
    period: { type: period, startDate: startDate || null, endDate: endDate || null },
    stats: {
      general: {
        totalEventos: parseInt(g.totalEventos) || 0, totalInscripciones: parseInt(g.totalInscripciones) || 0,
        totalAsistencias: parseInt(g.totalAsistencias) || 0, totalAusencias: parseInt(g.totalAusencias) || 0,
        estudiantesUnicos: parseInt(g.estudiantesUnicos) || 0, promedioAsistencia: parseFloat(g.promedioAsistencia) || 0,
      },
      byType: byTypeR.rows.map((r: any) => ({ tipo: r.tipo, totalEventos: parseInt(r.totalEventos) || 0, totalInscripciones: parseInt(r.totalInscripciones) || 0, totalAsistencias: parseInt(r.totalAsistencias) || 0 })),
      byNivel: byNivelR.rows.map((r: any) => ({ nivel: r.nivel, totalEventos: parseInt(r.totalEventos) || 0, totalInscripciones: parseInt(r.totalInscripciones) || 0, totalAsistencias: parseInt(r.totalAsistencias) || 0 })),
      recentEvents: recentR.rows.map((r: any) => ({ _id: r._id, dia: r.dia, hora: r.hora, tipo: r.tipo, nivel: r.nivel, step: r.step, titulo: r.titulo, inscritos: r.inscritos, bookingCount: parseInt(r.bookingCount) || 0, asistenciasCount: parseInt(r.asistenciasCount) || 0 })),
    },
  });
});
