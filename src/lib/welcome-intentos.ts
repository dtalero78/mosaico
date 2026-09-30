/**
 * Tope de sesiones de bienvenida (WELCOME) por alumno, y el mensaje con el que se
 * le manda el video cuando falta a la segunda.
 *
 * Regla (decisión del usuario, 30-sep-2026):
 *   - Un alumno puede tener como máximo `MAX_WELCOME_AGENDAMIENTOS` agendamientos
 *     WELCOME. Los CANCELADOS no cuentan (se cancelaron a tiempo). El tope vale
 *     para todos: el propio alumno al registrarse, Servicio y los administradores.
 *   - Quien faltó a las dos sin asistir a ninguna pasa a la pestaña "Video
 *     Welcome": se le envía por WhatsApp un enlace al video de bienvenida, y al
 *     enviarlo se le promueve a su curso real (el video reemplaza la sesión).
 *
 * Cliente + servidor (sin `server-only`).
 */

export const MAX_WELCOME_AGENDAMIENTOS = 2;

/** ¿Con estos agendamientos (sin cancelados) puede agendar otro? */
export function puedeAgendarOtroWelcome(agendados: number): boolean {
  return Number(agendados || 0) < MAX_WELCOME_AGENDAMIENTOS;
}

export function mensajeTopeWelcome(nombre?: string | null): string {
  const quien = String(nombre || '').trim();
  return `${quien ? quien + ' ya' : 'El alumno ya'} usó sus ${MAX_WELCOME_AGENDAMIENTOS} sesiones de bienvenida. `
    + 'Si faltó a la segunda, se le envía el video desde Servicio › Welcome Session › Video Welcome.';
}

/**
 * ¿Este evento del calendario es una bienvenida? Mismo criterio que
 * `esWelcomeSql` del repositorio de agendamientos, sobre la fila del evento.
 */
export function esEventoWelcome(ev: {
  tipo?: string | null; evento?: string | null; nivel?: string | null;
  nombreEvento?: string | null; tituloONivel?: string | null;
} | null | undefined): boolean {
  if (!ev) return false;
  const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
  return up(ev.tipo) === 'WELCOME' || up(ev.evento) === 'WELCOME' || up(ev.nivel) === 'WELCOME'
    || up(ev.nombreEvento) === 'WELCOME' || up(ev.tituloONivel).includes('WELCOME');
}

/** Ruta pública donde se ve el video (el enlace que va en el WhatsApp). */
export const RUTA_VIDEO_WELCOME = '/video-welcome';

/**
 * Texto del WhatsApp — redactado por el usuario (30-sep-2026). Va SIEMPRE al
 * teléfono del APODERADO, lo saluda por su nombre y nombra al alumno. La línea
 * del video se agregó porque el texto lo anuncia y, sin ella, no lo llevaría.
 */
export function mensajeVideoWelcome(p: {
  apoderado?: string | null;
  alumno?: string | null;
  enlaceVideo: string;
  enlacePlataforma: string;
}): string {
  const apoderado = String(p.apoderado || '').trim();
  const alumno = String(p.alumno || '').trim();
  return `Estimado/a${apoderado ? ` ${apoderado}` : ''}, buenas tardes 😊\n\n`
    + `Como no pudo asistir a su *sesión de bienvenida*, le enviaremos un *video explicativo sobre el ingreso a sus clases*. `
    + `Para que el usuario${alumno ? ` ${alumno}` : ''} pueda acceder fácilmente a la plataforma e iniciar su proceso académico con Mosaico.\n\n`
    + `▶️ Video: ${p.enlaceVideo}\n\n`
    + `Le recomendamos revisarlo con anticipación. Recuerde que tendrá acceso a la plataforma *10 días antes del inicio de sus clases*, una vez creado su perfil.\n\n`
    + `🌐 ${p.enlacePlataforma}\n\n`
    + `¡Bienvenido/a a MOSAICO! 🧮💙`;
}

/** Teléfono utilizable del apoderado (sólo dígitos, con indicativo) o '' si no hay. */
export function telefonoApoderado(raw?: string | null): string {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

/** Tipos de archivo aceptados al reemplazar el video. */
export const VIDEO_WELCOME_TIPOS = ['video/mp4'] as const;
/** Tope al reemplazar (va como enlace, no como adjunto, así que no rige el de WhatsApp). */
export const VIDEO_WELCOME_MAX_MB = 300;
/** Prefijo en Spaces. */
export const VIDEO_WELCOME_PREFIJO = 'videos/welcome/';
/** Máximo de envíos por llamada (van de a uno, por el límite de Whapi). */
export const MAX_ENVIOS_VIDEO_POR_LOTE = 60;
