/**
 * GET /api/postgres/export/events
 * Export events as CSV with optional filters
 */

import { NextResponse } from 'next/server';
import { handlerWithAuth } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

export const GET = handlerWithAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const advisor = searchParams.get('advisor');
  const nivel = searchParams.get('nivel');
  const tipo = searchParams.get('tipo');

  const conditions: string[] = [];
  const values: any[] = [];
  let pi = 1;
  if (startDate) { conditions.push(`c."dia" >= $${pi}::timestamp`); values.push(startDate); pi++; }
  if (endDate) { conditions.push(`c."dia" <= $${pi}::timestamp`); values.push(endDate); pi++; }
  if (advisor) { conditions.push(`c."advisor" = $${pi}`); values.push(advisor); pi++; }
  if (nivel) { conditions.push(`COALESCE(c."nivel", c."tituloONivel") = $${pi}`); values.push(nivel); pi++; }
  if (tipo) { conditions.push(`COALESCE(c."tipo", c."evento") = $${pi}`); values.push(tipo); pi++; }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT c."_id", c."dia", c."hora", c."advisor", c."nivel", c."step", c."tipo", c."titulo",
            c."nombreEvento", c."tituloONivel", c."inscritos", c."limiteUsuarios", c."linkZoom", c."club",
            a."primerNombre" as "advisorPrimerNombre", a."primerApellido" as "advisorPrimerApellido",
            a."nombreCompleto" as "advisorNombreCompleto",
            COUNT(DISTINCT b."_id") as bookings_count,
            COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as asistencias_count
     FROM "CALENDARIO" c
     LEFT JOIN "GUIAS" a ON c."advisor" = a."_id"
     LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento"
     ${whereClause}
     GROUP BY c."_id", c."dia", c."hora", c."advisor", c."nivel", c."step", c."tipo",
              c."titulo", c."nombreEvento", c."tituloONivel", c."inscritos", c."limiteUsuarios",
              c."linkZoom", c."club", a."primerNombre", a."primerApellido", a."nombreCompleto"
     ORDER BY c."dia" DESC`,
    values
  );

  const headers = ['ID','Fecha','Hora','Advisor ID','Advisor Nombre','Nivel','Step','Tipo','Titulo','Nombre Evento','Inscritos','Limite','Bookings','Asistencias','Link Zoom','Club'];
  const csvRows = [headers.join(',')];

  for (const row of result.rows) {
    const advisorName = row.advisorNombreCompleto || (row.advisorPrimerNombre ? `${row.advisorPrimerNombre} ${row.advisorPrimerApellido || ''}`.trim() : '');
    csvRows.push([
      row._id, row.dia ? new Date(row.dia).toISOString() : '', row.hora || '', row.advisor || '',
      `"${(advisorName || '').replace(/"/g, '""')}"`, row.nivel || '', row.step || '', row.tipo || '',
      `"${(row.titulo || '').replace(/"/g, '""')}"`, `"${(row.nombreEvento || '').replace(/"/g, '""')}"`,
      row.inscritos || 0, row.limiteUsuarios || 0, row.bookings_count || 0, row.asistencias_count || 0,
      row.linkZoom || '', row.club || '',
    ].join(','));
  }

  return new NextResponse(csvRows.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="events_${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
});
