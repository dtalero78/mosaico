import 'server-only';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { generateId } from '@/lib/id-generator';
import { spacesClient, SPACES_BUCKET, getPresignedGetUrl, deleteObject } from '@/lib/spaces';
import { sendWhatsAppMessage, formatPhoneNumber } from '@/lib/whatsapp';
import { BookingRepository } from '@/repositories/booking.repository';
import { promoteFromWelcome } from '@/services/student.service';
import {
  mensajeVideoWelcome, telefonoApoderado, RUTA_VIDEO_WELCOME, VIDEO_WELCOME_PREFIJO, MAX_ENVIOS_VIDEO_POR_LOTE,
} from '@/lib/welcome-intentos';

/**
 * Video de bienvenida para quien faltó a sus 2 sesiones WELCOME
 * (Servicio › Welcome Session › Video Welcome).
 *
 * - El video vive en Spaces (privado) y su referencia en APP_CONFIG
 *   `welcome_video`. Lo que se envía es un ENLACE a una página pública de la
 *   plataforma (`/video-welcome`) que siempre muestra el video vigente: así se
 *   puede reemplazar sin volver a enviar nada, y el archivo no choca con el
 *   límite de 16 MB de los adjuntos de WhatsApp (el actual pesa 18 MB).
 * - El WhatsApp va SIEMPRE al teléfono del APODERADO (texto del usuario, lo
 *   saluda por su nombre y nombra al alumno). Sin teléfono de apoderado no se envía.
 * - Cada envío queda en WELCOME_VIDEO_ENVIOS.
 * - Al enviar, el alumno se promueve de WELCOME a su curso real (decisión del
 *   usuario: el video reemplaza la sesión de bienvenida).
 */

const CONFIG_KEY = 'welcome_video';

export interface VideoWelcomeConfig {
  key: string;
  nombre: string;
  tamano: number | null;
  subidoPor: string | null;
  subidoEn: string | null;
}

export async function getVideoConfig(): Promise<VideoWelcomeConfig | null> {
  const row = await queryOne<{ value: string }>(
    `SELECT "value" FROM "APP_CONFIG" WHERE "key" = $1`, [CONFIG_KEY],
  ).catch(() => null);
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value);
    return v?.key ? v as VideoWelcomeConfig : null;
  } catch { return null; }
}

const baseUrl = () => (process.env.APP_URL || process.env.NEXTAUTH_URL || 'https://mosaicosorobanplataforma.com').replace(/\/+$/, '');

/** Enlace público al video que va en el WhatsApp. */
export function enlaceVideoWelcome(): string {
  return `${baseUrl()}${RUTA_VIDEO_WELCOME}`;
}

/** Enlace a la plataforma (línea 🌐 del mensaje). */
export function enlacePlataforma(): string {
  return `${baseUrl()}/`;
}

/** URL temporal para reproducir el video vigente (la usa la página pública). */
export async function urlReproduccionVideo(expiraSeg = 3 * 3600): Promise<{ url: string; nombre: string } | null> {
  const cfg = await getVideoConfig();
  if (!cfg) return null;
  return { url: await getPresignedGetUrl(cfg.key, expiraSeg), nombre: cfg.nombre };
}

/**
 * Registra el video recién subido como el vigente. Comprueba que el objeto exista
 * en Spaces (el navegador lo subió directo) y borra el anterior, best-effort.
 */
export async function reemplazarVideo(
  input: { key: string; nombre: string; tamano?: number | null },
  actor: { email: string; nombre?: string | null },
): Promise<VideoWelcomeConfig> {
  const key = String(input.key || '').trim();
  if (!key.startsWith(VIDEO_WELCOME_PREFIJO) || key.includes('..')) {
    throw new ValidationError('Archivo de video no válido.');
  }
  let tamano: number | null = input.tamano ?? null;
  try {
    const head = await spacesClient.send(new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    tamano = Number(head.ContentLength ?? tamano ?? 0) || tamano;
  } catch {
    throw new ValidationError('El video no terminó de subir. Vuelve a intentarlo.');
  }
  const anterior = await getVideoConfig();
  const cfg: VideoWelcomeConfig = {
    key,
    nombre: String(input.nombre || '').trim() || key.split('/').pop() || 'video.mp4',
    tamano,
    subidoPor: actor.nombre || actor.email,
    subidoEn: new Date().toISOString(),
  };
  await query(
    `INSERT INTO "APP_CONFIG" ("key","value","updatedBy","_updatedDate") VALUES ($1,$2,$3,NOW())
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedBy" = EXCLUDED."updatedBy", "_updatedDate" = NOW()`,
    [CONFIG_KEY, JSON.stringify(cfg), actor.email],
  );
  if (anterior?.key && anterior.key !== key) {
    await deleteObject(anterior.key).catch(err => console.warn('[welcome-video] no se borró el video anterior:', err?.message));
  }
  return cfg;
}

// ── Alumnos de la pestaña ────────────────────────────────────────────────────

export interface CandidatoVideo {
  academicaId: string;
  primerNombre: string;
  primerApellido: string;
  numeroId: string;
  contrato: string;
  celular: string;
  campaign: string;
  tipoCurso: string;
  /** Curso en ACADEMICA: 'WELCOME' si aún no se le promueve. */
  cursoAcademica: string;
  /** Nombre y teléfono del apoderado: el video va SIEMPRE a él. */
  apoderado: string;
  apoderadoTelefono: string;
  /** Última sesión perdida (la pestaña agrupa por ella). */
  fechaEvento: string;
  eventoId: string;
  modulo: string;
  advisorNombre: string;
  faltas: number;
  /** Teléfono del apoderado ya normalizado ('' si no hay uno válido). */
  destino: string;
  envios: number;
  ultimoEnvio: { fecha: string; por: string; telefono: string } | null;
}

export async function listarCandidatos(): Promise<CandidatoVideo[]> {
  const filas: any[] = await BookingRepository.findWelcomeVideoCandidatos();
  if (!filas.length) return [];
  const ids = filas.map(f => f.academicaId);
  const envios = await queryMany<any>(
    `SELECT DISTINCT ON ("academicaId") "academicaId", "_createdDate", "enviadoPorNombre", "enviadoPor", "telefono",
            COUNT(*) OVER (PARTITION BY "academicaId")::int AS n
       FROM "WELCOME_VIDEO_ENVIOS" WHERE "academicaId" = ANY($1::text[])
      ORDER BY "academicaId", "_createdDate" DESC`,
    [ids],
  ).catch(() => [] as any[]);
  const porAlumno = new Map(envios.map(e => [e.academicaId, e]));
  return filas.map((f) => {
    const e = porAlumno.get(f.academicaId);
    return {
      ...f,
      fechaEvento: f.fechaEvento instanceof Date ? f.fechaEvento.toISOString() : String(f.fechaEvento),
      faltas: Number(f.faltas || 0),
      destino: telefonoApoderado(f.apoderadoTelefono),
      envios: Number(e?.n || 0),
      ultimoEnvio: e ? {
        fecha: e._createdDate instanceof Date ? e._createdDate.toISOString() : String(e._createdDate),
        por: e.enviadoPorNombre || e.enviadoPor,
        telefono: e.telefono,
      } : null,
    } as CandidatoVideo;
  });
}

// ── Envío ────────────────────────────────────────────────────────────────────

export interface ResultadoEnvio {
  academicaId: string;
  nombre: string;
  ok: boolean;
  telefono?: string;
  promovido?: boolean;
  aviso?: string;
  error?: string;
}

/**
 * Envía el enlace del video a cada alumno, UNO A UNO (Whapi limita la tasa), y
 * al que sigue en el curso puente WELCOME lo promueve a su curso real.
 *
 * Sólo se envía a alumnos que ESTÁN en la pestaña (faltaron a su segunda
 * bienvenida): la lista se recalcula aquí, no se toma del navegador. Un fallo en
 * uno no detiene a los demás; cada resultado vuelve con su motivo.
 */
export async function enviarVideo(
  academicaIds: string[],
  actor: { email: string; nombre?: string | null },
): Promise<{ resultados: ResultadoEnvio[]; enviados: number; fallidos: number }> {
  const pedidos = Array.from(new Set((academicaIds || []).map(v => String(v || '').trim()).filter(Boolean)));
  if (!pedidos.length) throw new ValidationError('No hay alumnos seleccionados.');
  if (pedidos.length > MAX_ENVIOS_VIDEO_POR_LOTE) {
    throw new ValidationError(`Máximo ${MAX_ENVIOS_VIDEO_POR_LOTE} envíos por operación.`);
  }
  const cfg = await getVideoConfig();
  if (!cfg) throw new ValidationError('Aún no hay video de bienvenida cargado: súbelo antes de enviarlo.');

  const candidatos = new Map((await listarCandidatos()).map(c => [c.academicaId, c]));
  const enlace = enlaceVideoWelcome();
  const plataforma = enlacePlataforma();
  const resultados: ResultadoEnvio[] = [];

  for (const id of pedidos) {
    const c = candidatos.get(id);
    if (!c) {
      resultados.push({ academicaId: id, nombre: id, ok: false, error: 'No está en Video Welcome (no ha faltado a sus 2 bienvenidas).' });
      continue;
    }
    const nombre = `${c.primerNombre} ${c.primerApellido}`.trim();
    let telefono = '';
    try {
      if (!c.destino) throw new Error('sin teléfono');
      telefono = formatPhoneNumber(c.destino);
    } catch {
      resultados.push({ academicaId: id, nombre, ok: false, error: 'El apoderado no tiene un teléfono válido: complétalo en la ficha del alumno.' });
      continue;
    }
    try {
      await sendWhatsAppMessage(telefono, mensajeVideoWelcome({
        apoderado: c.apoderado, alumno: nombre, enlaceVideo: enlace, enlacePlataforma: plataforma,
      }));
    } catch (err: any) {
      resultados.push({ academicaId: id, nombre, ok: false, telefono, error: err?.message || 'No se pudo enviar el WhatsApp.' });
      continue;
    }

    // Enviado. Se promueve a quien sigue en WELCOME; si falla, el envío ya salió
    // y queda registrado igual, con el motivo.
    let promovido = false;
    let promocionDetalle: string | null = null;
    if (String(c.cursoAcademica || '').toUpperCase() === 'WELCOME') {
      try {
        await promoteFromWelcome(id, { email: actor.email, nombre: `${actor.nombre || actor.email} (video de bienvenida)` });
        promovido = true;
      } catch (err: any) {
        promocionDetalle = `No se promovió: ${err?.message || 'error'}`;
      }
    } else {
      promocionDetalle = `Ya estaba en su curso (${c.cursoAcademica || 'sin curso'}).`;
    }

    await query(
      `INSERT INTO "WELCOME_VIDEO_ENVIOS"
         ("_id","academicaId","numeroId","telefono","usoApoderado","videoKey","enviadoPor","enviadoPorNombre","promovido","promocionDetalle")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [generateId('wve'), id, c.numeroId || null, telefono, true, cfg.key,
        actor.email, actor.nombre || null, promovido, promocionDetalle],
    ).catch(err => console.error('[welcome-video] envío sin registrar:', err?.message));

    resultados.push({
      academicaId: id, nombre, ok: true, telefono, promovido,
      aviso: promovido ? undefined : promocionDetalle || undefined,
    });
  }

  const enviados = resultados.filter(r => r.ok).length;
  return { resultados, enviados, fallidos: resultados.length - enviados };
}
