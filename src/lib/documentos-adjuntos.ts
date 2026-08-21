/**
 * Qué se puede adjuntar como documentación de un contrato (cliente + servidor).
 *
 * Además de fotos y PDF se aceptan **audios**: los apoderados mandan notas de voz
 * por WhatsApp y son parte de la gestión del contrato igual que un comprobante.
 *
 * Se listan varios tipos por formato porque el navegador no siempre reporta el
 * mismo: el mismo `.m4a` llega como `audio/mp4`, `audio/x-m4a` o `audio/aac` según
 * el sistema, y los `.ogg`/`.opus` de WhatsApp a veces llegan **sin tipo** o como
 * `application/octet-stream`. Por eso la validación admite además la EXTENSIÓN:
 * rechazar una nota de voz por cómo la etiquetó el navegador sería un fallo
 * incomprensible para quien la está subiendo.
 */

export const TIPOS_IMAGEN = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
export const TIPOS_PDF = ['application/pdf'];
export const TIPOS_AUDIO = [
  'audio/mpeg', 'audio/mp3',           // .mp3
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', // .m4a / .aac (iPhone)
  'audio/ogg', 'audio/opus',           // .ogg / .opus (WhatsApp, Android)
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/3gpp', 'audio/amr',
];

export const TIPOS_PERMITIDOS = [...TIPOS_IMAGEN, ...TIPOS_PDF, ...TIPOS_AUDIO];

/** Extensiones de audio, para cuando el navegador no manda un tipo reconocible. */
export const EXT_AUDIO = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm', '3gp', '3gpp', 'amr'];

/** Lo que se le pasa al selector de archivos (`input.accept`). */
export const ACCEPT_DOCUMENTOS = [...TIPOS_PERMITIDOS, ...EXT_AUDIO.map(e => `.${e}`)].join(',');

/** Tamaño máximo. El audio pesa más que una foto: una nota de voz larga en `.wav` no cabría en 20 MB. */
export const MAX_MB_DOCUMENTO = 40;

const ext = (nombre: string) => String(nombre || '').split('.').pop()?.toLowerCase() || '';

export function esAudio(tipo?: string | null, nombre?: string | null): boolean {
  const t = String(tipo || '').toLowerCase();
  if (t.startsWith('audio/')) return true;
  return EXT_AUDIO.includes(ext(nombre || ''));
}

export function esImagen(tipo?: string | null, nombre?: string | null): boolean {
  const t = String(tipo || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  return ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext(nombre || ''));
}

/** ¿Se admite este archivo? Por tipo o, si el navegador no lo etiquetó bien, por extensión. */
export function documentoPermitido(tipo?: string | null, nombre?: string | null): boolean {
  const t = String(tipo || '').toLowerCase();
  if (TIPOS_PERMITIDOS.includes(t)) return true;
  const e = ext(nombre || '');
  return EXT_AUDIO.includes(e) || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'].includes(e);
}

/** Etiqueta corta para la lista de documentos. */
export function etiquetaDocumento(tipo?: string | null, nombre?: string | null): string {
  if (esAudio(tipo, nombre)) return 'Audio';
  if (esImagen(tipo, nombre)) return 'Imagen';
  return 'PDF';
}
