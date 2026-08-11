/**
 * WhatsApp Messaging Utility
 *
 * Shared server-side utility for sending WhatsApp messages via Whapi.cloud.
 * Extracted from src/app/api/wix/sendWhatsApp/route.ts for reuse across services.
 */

import 'server-only';

const WHAPI_URL = 'https://gate.whapi.cloud/messages/text';
// Línea propia de MOSAICO (+56 9 7981 9760). El env var manda si está seteado.
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || 'h2vjBWeG8csEl45GIuKgOr5pvGwCVTbu';

/**
 * Format a phone number for WhatsApp: strip non-digits and validate length.
 */
export function formatPhoneNumber(raw: string): string {
  const str = String(raw || '');
  const digits = str.replace(/\D/g, '');
  if (digits.length < 10) {
    throw new Error(`Número inválido (muy corto, ${digits.length} dígitos): ${str}`);
  }
  return digits;
}

/**
 * Send a text message via WhatsApp (Whapi.cloud gateway).
 * Throws on failure.
 */
export async function sendWhatsAppMessage(toNumber: string, messageBody: string): Promise<any> {
  const formattedNumber = formatPhoneNumber(toNumber);

  const response = await fetch(WHAPI_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${WHAPI_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      typing_time: 0,
      to: formattedNumber,
      body: messageBody,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    let errorDetails = responseText;
    try {
      const errorJson = JSON.parse(responseText);
      errorDetails = errorJson.message || errorJson.error || responseText;
    } catch { /* keep raw text */ }

    throw new Error(`WhatsApp API error (${response.status}): ${errorDetails}`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { response: responseText };
  }
}

export type WhatsAppMediaKind = 'image' | 'video' | 'document';

const WHAPI_MEDIA_ENDPOINT: Record<WhatsAppMediaKind, string> = {
  image: 'https://gate.whapi.cloud/messages/image',
  video: 'https://gate.whapi.cloud/messages/video',
  document: 'https://gate.whapi.cloud/messages/document',
};

/**
 * Send a media message (image / video / document) via WhatsApp (Whapi.cloud).
 * `mediaUrl` debe ser una URL accesible por Whapi (p.ej. presigned de Spaces).
 * `caption` va como texto del mensaje. `filename` solo aplica a documentos.
 * Throws on failure.
 */
export async function sendWhatsAppMedia(
  toNumber: string,
  mediaUrl: string,
  kind: WhatsAppMediaKind,
  caption?: string,
  filename?: string,
): Promise<any> {
  const formattedNumber = formatPhoneNumber(toNumber);
  const payload: Record<string, any> = { to: formattedNumber, media: mediaUrl };
  if (caption && caption.trim()) payload.caption = caption;
  if (kind === 'document' && filename) payload.filename = filename;

  const response = await fetch(WHAPI_MEDIA_ENDPOINT[kind], {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${WHAPI_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    let errorDetails = responseText;
    try {
      const errorJson = JSON.parse(responseText);
      errorDetails = errorJson.message || errorJson.error || responseText;
    } catch { /* keep raw text */ }
    throw new Error(`WhatsApp media API error (${response.status}): ${errorDetails}`);
  }
  try {
    return JSON.parse(responseText);
  } catch {
    return { response: responseText };
  }
}
