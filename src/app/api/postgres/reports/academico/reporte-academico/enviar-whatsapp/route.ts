import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ForbiddenError } from '@/lib/errors';
import { getReporteAcademico } from '@/services/reporte-academico.service';
import { buildReporteIndividualHtml } from '@/lib/reporte-academico-pdf';
import { htmlToPdfBuffer } from '@/lib/pdf';
import { formatPhoneNumber } from '@/lib/whatsapp';

const WHAPI_TOKEN = process.env.WHAPI_TOKEN || 'h2vjBWeG8csEl45GIuKgOr5pvGwCVTbu';

/**
 * POST /api/postgres/reports/academico/reporte-academico/enviar-whatsapp
 *
 * Genera el PDF del informe INDIVIDUAL de un estudiante (misma semana/filtros del
 * reporte) y lo envía por WhatsApp SOLO al apoderado de ese estudiante.
 * Body: { academicaId, curso, salon, campaign?, guia?, startDate?, endDate? }
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_INDIVIDUAL);
  // El envío del informe por WhatsApp NO está disponible para los guías.
  if (String((session?.user as any)?.role || '') === 'GUIA') {
    throw new ForbiddenError('Los guías no pueden enviar el informe por WhatsApp.');
  }
  const b = await request.json().catch(() => ({}));
  const academicaId = String(b?.academicaId || '').trim();
  if (!academicaId) throw new ValidationError('Falta el estudiante.');

  const data = await getReporteAcademico({
    guia: b?.guia || undefined, curso: b?.curso || undefined, salon: b?.salon || undefined,
    campaign: b?.campaign || undefined, startDate: b?.startDate || undefined, endDate: b?.endDate || undefined,
  }, session);
  const row = (data.rows || []).find((r: any) => r.academicaId === academicaId);
  if (!row) throw new NotFoundError('No se encontró el estudiante en el reporte.');

  const phone = formatPhoneNumber(row.apoderadoTelefono || '');
  if (!phone) throw new ValidationError('El apoderado de este estudiante no tiene teléfono registrado.');

  const html = buildReporteIndividualHtml(row, {
    curso: String((data as any).curso || ''), salon: String((data as any).salon || ''), guiaNombre: String((data as any).guiaNombre || ''),
    semanaInicio: String((data as any).semanaInicio || ''), semanaFin: String((data as any).semanaFin || ''),
  });
  const pdf = await htmlToPdfBuffer(html, {
    format: 'Letter', printBackground: true,
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  });

  // El nombre viaja como nombre de archivo, así que los acentos se transliteran
  // (NFD + quitar diacríticos) en vez de reemplazarse por "_": antes "León"
  // llegaba como "Le_n".
  const nombreLimpio = String(row.nombre || 'estudiante')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const nombreArch = `Reporte_${nombreLimpio || 'estudiante'}_${data.semanaInicio}.pdf`;

  // El PDF viaja EN EL MENSAJE como data URI, no como enlace a un temporal.
  // Con una URL firmada de Spaces (que lleva query string) Whapi no resolvía el
  // tipo y el apoderado recibía el archivo como "BIN" en vez de PDF, aunque el
  // objeto y su cabecera fueran application/pdf. En el prefijo del data URI el
  // tipo va declarado y no hay nada que inferir. De paso desaparece el temporal
  // en Spaces y con él el riesgo de borrarlo antes de que Whapi lo descargue.
  const media = `data:application/pdf;base64,${pdf.toString('base64')}`;
  let sent: any;
  try {
    const res = await fetch('https://gate.whapi.cloud/messages/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${WHAPI_TOKEN}` },
      body: JSON.stringify({
        to: phone, media, filename: nombreArch,
        caption: `Hola, adjunto el reporte académico de la semana de ${row.nombre} en MOSAICO. 📊`,
      }),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`Whapi ${res.status}: ${t.slice(0, 180)}`); }
    sent = await res.json().catch(() => ({}));
  } catch (e: any) {
    throw new ValidationError('No se pudo enviar por WhatsApp: ' + (e?.message || 'error'));
  }

  const masked = phone.length > 4 ? `••••${phone.slice(-4)}` : phone;
  return successResponse({ ok: true, to: masked, nombre: row.nombre });
});
