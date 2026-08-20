/**
 * Ventana en la que el alumno puede entrar a Zoom desde su panel
 * (cliente + servidor — sin `server-only`).
 *
 * El ícono se habilita `ZOOM_ABRE_MIN_ANTES` minutos antes del inicio y se
 * cierra `ZOOM_CIERRA_MIN_DESPUES` después; fuera de ahí queda bloqueado con un
 * reloj. El texto que ve el alumno se arma con estas mismas constantes, así que
 * cambiar el número aquí lo cambia en pantalla — sin un "5" suelto en el HTML
 * que se despegue de la lógica.
 *
 * ⚠ Se compara contra el INSTANTE, no contra la hora local: `fechaEvento` es
 * `timestamptz` y viaja como UTC, así que un alumno en Chile y otro en Colombia
 * ven el ícono abrirse a la vez, cada uno a la hora de su reloj.
 */

/** Minutos ANTES del inicio en que se habilita el ingreso. */
export const ZOOM_ABRE_MIN_ANTES = 10;

/** Minutos DESPUÉS del inicio en que se deja de ofrecer. */
export const ZOOM_CIERRA_MIN_DESPUES = 15;

/**
 * Lo que se le dice al alumno en cada estado. Vive aquí, con las constantes, para
 * que los minutos del texto no puedan despegarse de los de la lógica.
 */
export const MENSAJE_ZOOM_LISTO =
  `Enlace listo, disponible por ${ZOOM_CIERRA_MIN_DESPUES} minutos después del inicio, da click en el icono`;

export const MENSAJE_ZOOM_ESPERA =
  `Enlace disponible ${ZOOM_ABRE_MIN_ANTES} min antes, recuerda refrescar el navegador`;

/** ¿Se puede entrar a Zoom ahora mismo para una sesión que empieza en `inicioMs`? */
export function zoomDisponible(inicioMs: number, ahoraMs: number = Date.now()): boolean {
  return ahoraMs >= inicioMs - ZOOM_ABRE_MIN_ANTES * 60_000
      && ahoraMs <= inicioMs + ZOOM_CIERRA_MIN_DESPUES * 60_000;
}
