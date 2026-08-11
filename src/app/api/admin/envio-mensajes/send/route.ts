/**
 * POST /api/admin/envio-mensajes/send
 *
 * Envía mensajes WhatsApp a una lista de destinatarios usando una plantilla
 * existente en MESSAGE_TEMPLATES. Procesa SECUENCIALMENTE (no en paralelo)
 * para no saturar el rate-limit de Whapi.cloud.
 *
 * Body: {
 *   plantillaId: string,
 *   destinatarios: [{
 *     numeroId, nombre, primerApellido?, celular,
 *     nivel?, step?, plataforma?, contrato?
 *   }]
 * }
 *
 * Cap: máx 300 destinatarios por operación (consistente con lookup).
 *
 * Por cada destinatario:
 *   1. Reemplaza placeholders en el template con sus datos
 *   2. Envía via sendWhatsAppMessage(celular, mensajeFinal)
 *   3. Registra resultado (ok/error)
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { MessageTemplatesRepository } from '@/repositories/message-templates.repository';
import { fillTemplate } from '@/lib/message-template-filler';
import { sendWhatsAppMessage, sendWhatsAppMedia, type WhatsAppMediaKind } from '@/lib/whatsapp';
import { getPresignedGetUrl } from '@/lib/spaces';

const MAX_SEND = 300;
// Con adjunto (imagen/video/documento) el tope baja para no arriesgar el bloqueo
// de la línea: WhatsApp marca los envíos masivos con media mucho más agresivamente.
const MAX_SEND_MEDIA = 30;

interface Recipient {
  numeroId: string;
  nombre?: string | null;
  primerApellido?: string | null;
  celular: string;
  nivel?: string | null;
  step?: string | null;
  plataforma?: string | null;
  contrato?: string | null;
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.ENVIO_MENSAJES);

  const body = await request.json();
  const plantillaId = String(body?.plantillaId || '').trim();
  const destinatarios: Recipient[] = Array.isArray(body?.destinatarios) ? body.destinatarios : [];
  // Adjunto opcional (subido antes a Spaces vía /presign): { key, kind, filename }
  const mediaIn = body?.media && body.media.key ? body.media : null;
  const mediaKind: WhatsAppMediaKind = ['image', 'video', 'document'].includes(mediaIn?.kind)
    ? mediaIn.kind : 'document';

  if (!plantillaId) throw new ValidationError('plantillaId requerido');
  if (destinatarios.length === 0) throw new ValidationError('destinatarios requerido (array no vacío)');
  const cap = mediaIn ? MAX_SEND_MEDIA : MAX_SEND;
  if (destinatarios.length > cap) {
    throw new ValidationError(
      mediaIn
        ? `Con adjunto el máximo es ${MAX_SEND_MEDIA} destinatarios. Recibidos: ${destinatarios.length}`
        : `Máximo ${MAX_SEND} destinatarios por operación. Recibidos: ${destinatarios.length}`
    );
  }

  // Cargar plantilla y validar que está activa
  const tpl = await MessageTemplatesRepository.findById(plantillaId);
  if (!tpl) throw new NotFoundError('Plantilla', plantillaId);
  if (!tpl.activo) throw new ValidationError(`La plantilla "${tpl.nombre}" está inactiva. Actívala en Gestión de Plantillas.`);

  // Validación previa: todos los destinatarios deben tener celular y numeroId
  for (let i = 0; i < destinatarios.length; i++) {
    const d = destinatarios[i];
    if (!d?.numeroId) throw new ValidationError(`destinatarios[${i}].numeroId requerido`);
    if (!d?.celular)  throw new ValidationError(`destinatarios[${i}].celular requerido`);
  }

  // Envío secuencial — captura errores individuales para no abortar el lote
  const resultados: Array<{
    numeroId: string;
    nombre: string;
    celular: string;
    ok: boolean;
    mensajeEnviado?: string;
    error?: string;
  }> = [];

  // Si hay adjunto, generar UNA URL de lectura (Whapi la descarga). TTL holgado
  // para los ≤30 envíos secuenciales.
  const mediaUrl = mediaIn ? await getPresignedGetUrl(mediaIn.key, 1800) : null;

  for (const d of destinatarios) {
    const mensajeFinal = fillTemplate(tpl.contenido, {
      nombre: d.nombre, primerApellido: d.primerApellido,
      nivel: d.nivel, step: d.step,
      plataforma: d.plataforma, contrato: d.contrato,
      numeroId: d.numeroId,
    });

    try {
      if (mediaUrl) await sendWhatsAppMedia(d.celular, mediaUrl, mediaKind, mensajeFinal, mediaIn?.filename);
      else await sendWhatsAppMessage(d.celular, mensajeFinal);
      resultados.push({
        numeroId: d.numeroId,
        nombre: `${d.nombre || ''} ${d.primerApellido || ''}`.trim() || '(sin nombre)',
        celular: d.celular,
        ok: true,
        mensajeEnviado: mensajeFinal,
      });
    } catch (err: any) {
      resultados.push({
        numeroId: d.numeroId,
        nombre: `${d.nombre || ''} ${d.primerApellido || ''}`.trim() || '(sin nombre)',
        celular: d.celular,
        ok: false,
        error: err?.message || 'Error desconocido',
      });
    }
  }

  const enviados = resultados.filter(r => r.ok).length;
  const fallidos = resultados.length - enviados;

  return successResponse({
    plantilla: { _id: tpl._id, slug: tpl.slug, nombre: tpl.nombre },
    enviados, fallidos,
    resultados,
  });
});
