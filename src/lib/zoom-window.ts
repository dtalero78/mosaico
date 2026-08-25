/**
 * Ventana en la que el alumno puede entrar a Zoom desde su panel
 * (cliente + servidor — sin `server-only`).
 *
 * Son DOS tiempos distintos:
 *
 *  1. **Ventana de ingreso** — `[inicio − 5 min, inicio + 15 min]`. Es el plazo
 *     para *generar el acceso*: el alumno pulsa el ícono y queda registrado.
 *
 *  2. **Reconexión** — si generó el acceso dentro de esa ventana, su ícono le
 *     sigue activo hasta **10 minutos antes de que termine la clase**. Sirve para
 *     volver a entrar si se le cae la conexión o cambia de dispositivo. Es
 *     PERSONAL: quien no alcanzó a entrar no lo tiene.
 *
 * El cierre se deriva de la DURACIÓN de la clase, no de un número escrito a mano:
 * 50 min en una sesión de una hora, 140 en un bloque de 2h30 de IMPULSA, 20 en
 * una nivelación de media hora. Si mañana cambia la duración de un tipo de clase,
 * esto se ajusta solo.
 *
 * ⚠ Se compara contra el INSTANTE, no contra la hora local: `fechaEvento` es
 * `timestamptz` y viaja como UTC, así que un alumno en Chile y otro en Colombia
 * ven el ícono abrirse a la vez, cada uno a la hora de su reloj.
 */
import { eventDurationMin } from './event-duration';

/** Minutos ANTES del inicio en que se habilita el ingreso. */
export const ZOOM_ABRE_MIN_ANTES = 5;

/** Minutos DESPUÉS del inicio en que se cierra el plazo para generar el acceso. */
export const ZOOM_CIERRA_MIN_DESPUES = 15;

/** Minutos antes del FIN de la clase en que se corta la reconexión. */
export const ZOOM_RECONEXION_MARGEN_FINAL_MIN = 10;

export type EstadoZoom =
  | 'espera'       // todavía no abre
  | 'disponible'   // puede entrar
  | 'vencido'      // se le pasó el plazo y nunca entró
  | 'cerrado';     // entró, pero ya terminó su tiempo de reconexión

/**
 * Instantes clave de una clase, en milisegundos.
 *
 * `horario` es el del curso ("MAR-JUE 19:00-19:50") y manda sobre el tipo: una
 * sesión de 50 min no dura los 60 del default, y con 10 de margen la diferencia
 * se nota.
 */
export function zoomLimites(inicioMs: number, tipo?: string | null, horario?: string | null) {
  const dur = eventDurationMin(tipo || undefined, horario || undefined);
  const abre = inicioMs - ZOOM_ABRE_MIN_ANTES * 60_000;
  const cierraIngreso = inicioMs + ZOOM_CIERRA_MIN_DESPUES * 60_000;
  // La reconexión nunca puede acortar la ventana de ingreso: en una clase muy
  // corta `duración − 10` caería antes del cierre normal.
  const cierraReconexion = Math.max(
    cierraIngreso,
    inicioMs + (dur - ZOOM_RECONEXION_MARGEN_FINAL_MIN) * 60_000,
  );
  return { abre, cierraIngreso, cierraReconexion, durMin: dur };
}

/**
 * Estado del ícono para ESTE alumno.
 *
 * `accesoEnMs` es el instante en que generó el acceso (null si nunca lo hizo).
 * No importa si entró antes o después de la hora: basta con que haya sido dentro
 * de la ventana de ingreso.
 */
export function estadoZoom(
  inicioMs: number,
  tipo?: string | null,
  horario?: string | null,
  accesoEnMs?: number | null,
  ahoraMs: number = Date.now(),
): EstadoZoom {
  const { abre, cierraIngreso, cierraReconexion } = zoomLimites(inicioMs, tipo, horario);
  if (ahoraMs < abre) return 'espera';
  if (ahoraMs <= cierraIngreso) return 'disponible';
  if (accesoEnMs == null) return 'vencido';
  return ahoraMs <= cierraReconexion ? 'disponible' : 'cerrado';
}

/** ¿Puede entrar ahora? Atajo sobre `estadoZoom`. */
export function zoomDisponible(
  inicioMs: number, tipo?: string | null, horario?: string | null,
  accesoEnMs?: number | null, ahoraMs: number = Date.now(),
): boolean {
  return estadoZoom(inicioMs, tipo, horario, accesoEnMs, ahoraMs) === 'disponible';
}

/**
 * ¿Está DENTRO del plazo para generar el acceso? Lo usa el servidor: registrar un
 * acceso fuera de la ventana no debe crear el derecho a reconectarse.
 */
export function dentroVentanaIngreso(
  inicioMs: number, ahoraMs: number = Date.now(),
): boolean {
  return ahoraMs >= inicioMs - ZOOM_ABRE_MIN_ANTES * 60_000
      && ahoraMs <= inicioMs + ZOOM_CIERRA_MIN_DESPUES * 60_000;
}

/**
 * Próximo instante en que el estado cambia (para programar el temporizador que
 * enciende o apaga el ícono solo, sin recargar). `null` si ya no cambia más.
 */
export function proximoCambioZoom(
  inicioMs: number, tipo?: string | null, horario?: string | null,
  accesoEnMs?: number | null, ahoraMs: number = Date.now(),
): number | null {
  const { abre, cierraIngreso, cierraReconexion } = zoomLimites(inicioMs, tipo, horario);
  const hitos = accesoEnMs != null ? [abre, cierraReconexion] : [abre, cierraIngreso];
  for (const t of hitos) if (ahoraMs < t) return t;
  return null;
}

/** Lo que se le dice al alumno en cada estado. Los minutos salen de las constantes. */
export const MENSAJE_ZOOM_LISTO =
  `Enlace listo, disponible por ${ZOOM_CIERRA_MIN_DESPUES} minutos después del inicio, da click en el icono`;

export const MENSAJE_ZOOM_ESPERA =
  `Enlace disponible ${ZOOM_ABRE_MIN_ANTES} min antes, recuerda refrescar el navegador`;

export const MENSAJE_ZOOM_RECONEXION =
  'Ya ingresaste. Si se te cae la conexión, puedes volver a entrar desde aquí';

export const MENSAJE_ZOOM_VENCIDO =
  `El plazo para ingresar venció (${ZOOM_CIERRA_MIN_DESPUES} min después del inicio). Comunícate con el Área de Servicio`;

export const MENSAJE_ZOOM_CERRADO =
  'La clase ya terminó';
