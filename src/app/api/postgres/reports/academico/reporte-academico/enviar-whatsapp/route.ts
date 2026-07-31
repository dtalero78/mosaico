import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { getReporteAcademico } from '@/services/reporte-academico.service';
import { buildReporteIndividualHtml } from '@/lib/reporte-academico-pdf';
import { htmlToPdfBuffer } from '@/lib/pdf';
import { putBuffer, getPresignedGetUrl, deleteObject } from '@/lib/spaces';
import { formatPhoneNumber } from '@/lib/whatsapp';
import { generateId } from '@/lib/id-generator';

const WHAPI_TOKEN = process.env.WHAPI_TOKEN || 'h2vjBWeG8csEl45GIuKgOr5pvGwCVTbu';

/**
 * POST /api/postgres/reports/academico/reporte-academico/enviar-whatsapp
 *
 * Genera el PDF del informe INDIVIDUAL de un estudiante (misma semana/filtros del
 * reporte) y lo envía por WhatsApp SOLO al apoderado de ese estudiante.
 * Body: { academicaId, curso, salon, campaign?, guia?, startDate?, endDate? }
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_VER);
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

  const key = `reportes/temp/${generateId('rep')}.pdf`;
  const nombreArch = `Reporte_${String(row.nombre || 'estudiante').replace(/[^a-zA-Z0-9]+/g, '_')}_${data.semanaInicio}.pdf`;
  let sent: any;
  try {
    await putBuffer(key, pdf, 'application/pdf');
    const url = await getPresignedGetUrl(key, 900);
    const res = await fetch('https://gate.whapi.cloud/messages/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': `Bearer ${WHAPI_TOKEN}` },
      body: JSON.stringify({
        to: phone, media: url, filename: nombreArch,
        caption: `Hola, adjunto el reporte académico de la semana de ${row.nombre} en MOSAICO. 📊`,
      }),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`Whapi ${res.status}: ${t.slice(0, 180)}`); }
    sent = await res.json().catch(() => ({}));
  } catch (e: any) {
    throw new ValidationError('No se pudo enviar por WhatsApp: ' + (e?.message || 'error'));
  } finally {
    // Whapi descarga el media al enviar; el temporal ya no se necesita.
    deleteObject(key).catch(() => {});
  }

  const masked = phone.length > 4 ? `••••${phone.slice(-4)}` : phone;
  return successResponse({ ok: true, to: masked, nombre: row.nombre });
});
