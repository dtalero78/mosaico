import 'server-only';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppConfigRepository } from '@/repositories/config.repository';
import { spacesClient, SPACES_BUCKET, getPresignedUrlEstable } from '@/lib/spaces';
import { ValidationError } from '@/lib/errors';

/**
 * Avisos del login (Mantenimiento › Avisos › Banner): carrusel de hasta 3 imágenes.
 *
 *   APP_CONFIG.banner_avisos  → JSON con la lista de avisos (orden, activo, fechas)
 *   APP_CONFIG.banner_active  → interruptor general "mostrar avisos en el login"
 *   Spaces avisos-login/<id>  → las imágenes (privadas; el login recibe URL firmada)
 *
 * Fechas `desde` / `hasta` (YYYY-MM-DD, ambas inclusive, opcionales) en hora de
 * Chile (America/Santiago).
 *
 * Legado: antes había una sola imagen en base64 en APP_CONFIG.banner_image. Mientras
 * no exista `banner_avisos` el login la sigue mostrando, y al abrir el editor se pasa
 * sola al carrusel (se sube a Spaces y se vacía banner_image).
 */

export const MAX_AVISOS = 3;
export const MAX_BYTES_AVISO = 7 * 1024 * 1024;

const AVISOS_KEY = 'banner_avisos';
const ACTIVE_KEY = 'banner_active';
const LEGACY_IMAGE_KEY = 'banner_image';
const PREFIJO = 'avisos-login/';

export interface AvisoLogin {
  id: string;
  key: string;          // objeto en Spaces
  nombre: string;       // referencia interna ("Feriado 31-oct")
  activo: boolean;
  orden: number;
  desde: string | null; // YYYY-MM-DD inclusive
  hasta: string | null; // YYYY-MM-DD inclusive
  subidoPor: string | null;
  subidoEn: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy (YYYY-MM-DD) en Chile. */
export function hoyAvisos(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}

export function avisoVigente(a: AvisoLogin, hoy = hoyAvisos()): boolean {
  if (!a.activo) return false;
  if (a.desde && hoy < a.desde) return false;
  if (a.hasta && hoy > a.hasta) return false;
  return true;
}

async function leerFila() {
  return AppConfigRepository.get(AVISOS_KEY);
}

export async function leerAvisos(): Promise<AvisoLogin[]> {
  const fila = await leerFila();
  if (!fila?.value) return [];
  try {
    const lista = JSON.parse(fila.value);
    return Array.isArray(lista) ? ordenar(lista) : [];
  } catch {
    return [];
  }
}

const ordenar = (l: AvisoLogin[]) => [...l].sort((a, b) => a.orden - b.orden);

export async function guardarAvisos(avisos: AvisoLogin[], email: string) {
  const normal = ordenar(avisos).map((a, i) => ({ ...a, orden: i + 1 }));
  await AppConfigRepository.set(AVISOS_KEY, JSON.stringify(normal), '#ffffff', email);
  return normal;
}

export async function leerActivo(): Promise<boolean> {
  return (await AppConfigRepository.get(ACTIVE_KEY))?.value === 'true';
}

export async function guardarActivo(activo: boolean, email: string) {
  await AppConfigRepository.set(ACTIVE_KEY, String(activo), '#ffffff', email);
}

/** Lo que ve el login: avisos vigentes en orden, con URL firmada. */
export async function avisosParaLogin(): Promise<{ id: string; url: string }[]> {
  if (!(await leerActivo())) return [];
  const fila = await leerFila();
  if (!fila) {
    // Aún no se abrió el editor nuevo: se sigue mostrando la imagen única de antes.
    const legado = (await AppConfigRepository.get(LEGACY_IMAGE_KEY))?.value;
    return legado ? [{ id: 'legado', url: legado }] : [];
  }
  const hoy = hoyAvisos();
  const vigentes = (await leerAvisos()).filter(a => avisoVigente(a, hoy));
  return Promise.all(vigentes.map(async a => ({ id: a.id, url: await getPresignedUrlEstable(a.key) })));
}

/** Tipo de imagen por sus primeros bytes (no por la extensión que manda el navegador). */
export function tipoImagen(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const nuevoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function subirImagenAviso(buf: Buffer, email: string): Promise<{ id: string; key: string }> {
  const tipo = tipoImagen(buf);
  if (!tipo) throw new ValidationError('El archivo no es una imagen PNG, JPG, GIF o WEBP válida');
  if (buf.length > MAX_BYTES_AVISO) throw new ValidationError('La imagen no puede superar 7 MB');
  const id = nuevoId();
  const key = `${PREFIJO}${id}.${tipo.ext}`;
  await spacesClient.send(new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    Body: buf,
    ContentType: tipo.mime,
    ACL: 'private',
    CacheControl: 'private, max-age=3600',
    Metadata: { 'subido-por': encodeURIComponent(email), 'subido-en': new Date().toISOString() },
  }));
  return { id, key };
}

export async function borrarImagenAviso(key: string) {
  if (!key.startsWith(PREFIJO)) return; // nunca se borra nada fuera de la carpeta de avisos
  await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
}

export function validarFecha(v: unknown, campo: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !FECHA.test(v)) throw new ValidationError(`${campo}: fecha inválida`);
  return v;
}

/**
 * Pasa la imagen única de antes (base64 en banner_image) al carrusel. Se llama al abrir
 * el editor; no hace nada si el carrusel ya existe.
 */
export async function migrarBannerLegado(email: string): Promise<void> {
  if (await leerFila()) return;
  const legado = (await AppConfigRepository.get(LEGACY_IMAGE_KEY))?.value || '';
  const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(legado);
  const avisos: AvisoLogin[] = [];
  if (m) {
    try {
      const { id, key } = await subirImagenAviso(Buffer.from(m[1], 'base64'), email);
      avisos.push({ id, key, nombre: 'Aviso actual', activo: true, orden: 1, desde: null, hasta: null, subidoPor: email, subidoEn: new Date().toISOString() });
    } catch (e) {
      // Si no se puede pasar (formato raro, Spaces caído) el login sigue mostrando la
      // imagen de antes y se reintenta la próxima vez que se abra el editor.
      console.warn('[Banner] No se pudo pasar el aviso anterior al carrusel:', (e as Error).message);
      return;
    }
  }
  await guardarAvisos(avisos, email);
  if (legado) await AppConfigRepository.set(LEGACY_IMAGE_KEY, '', '#ffffff', email);
}
