import 'server-only';
import { NextResponse } from 'next/server';
import { handlerWithAuth } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { htmlToPdfBuffer } from '@/lib/pdf';
import { protegerPdf } from '@/lib/pdf-protect';
import { getReporteDelEstudiante } from '@/services/reporte-estudiante.service';

/**
 * GET /api/postgres/panel-estudiante/reporte-academico/pdf?semana=YYYY-MM-DD
 * El mismo reporte, como PDF descargable.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  const semana = new URL(request.url).searchParams.get('semana') || undefined;
  const r = await getReporteDelEstudiante(session, semana);
  if (!r.disponible || !r.html) throw new ValidationError(r.motivo || 'El reporte no está disponible.');

  // Nunca se entrega sin clave: sin documento del titular no hay con qué protegerlo.
  if (!r.clavePdf) throw new ValidationError('No se pudo proteger el PDF: falta el documento del apoderado. Contacta a soporte.');

  const sinClave = await htmlToPdfBuffer(r.html, {
    format: 'Letter', printBackground: true,
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  });
  const pdf = await protegerPdf(sinClave, r.clavePdf);
  const nombre = String(r.nombre || 'estudiante')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Reporte_${nombre || 'estudiante'}_${r.semanaInicio}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
