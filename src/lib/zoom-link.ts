/**
 * La sala de Zoom del guía (cliente + servidor).
 *
 * Se guardaba tal cual lo que pegaran, y no todo lo que Zoom deja copiar es una
 * sala: el enlace de **chat directo** (`/launch/chat?…&email=…`) abre "Enviar
 * solicitud de contacto" en vez de la clase, y la portada `zoom.com` no lleva a
 * ninguna parte. Los dos llegaron a producción y dejaron a 132 alumnos sin poder
 * entrar.
 *
 * Sirven dos formas, que son las que Zoom entrega como invitación:
 *   https://<lo-que-sea>.zoom.us/j/<id>[?pwd=…]   ← reunión
 *   https://<lo-que-sea>.zoom.us/my/<nombre>      ← sala personal
 *
 * `/s/<id>` (el enlace con el que el anfitrión INICIA la reunión) se convierte a
 * `/j/<id>`: es la misma sala vista desde el lado del invitado, y copiarlo por
 * error es el desliz más fácil de cometer.
 */

/** Host de Zoom, con o sin subdominio (us02web, un dominio corporativo, …). */
const HOST_ZOOM = /^https?:\/\/([a-z0-9-]+\.)*zoom\.us\//i;

/** Deja el enlace en su forma de invitación. Devuelve '' si viene vacío. */
export function normalizarSalaZoom(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  // `#success` es la coletilla que Zoom añade al volver de abrir la app.
  const limpio = url.replace(/#success$/i, '');
  // El enlace del anfitrión (/s/) apunta a la misma reunión que el del invitado (/j/).
  return limpio.replace(/(\/\/[^/]*zoom\.us)\/s\/(\d+)/i, '$1/j/$2');
}

/** ¿Es un enlace por el que un alumno puede entrar a la clase? */
export function esSalaZoomValida(url: unknown): boolean {
  const u = normalizarSalaZoom(url);
  if (!u || !HOST_ZOOM.test(u)) return false;
  const ruta = u.replace(HOST_ZOOM, '/');
  return /^\/j\/\d+/i.test(ruta) || /^\/my\/[^/?#]+/i.test(ruta);
}

export const MENSAJE_ZOOM_INVALIDO =
  'El enlace de Zoom debe ser el de la sala (…zoom.us/j/NÚMERO o …zoom.us/my/NOMBRE). '
  + 'El enlace de chat o de contacto no sirve: al alumno le abre "Enviar solicitud de contacto" en vez de la clase.';
