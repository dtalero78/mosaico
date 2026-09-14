/**
 * Cómo sale un alumno de su salón cuando se le inactiva.
 *
 * Vive aquí —cliente y servidor— porque la misma lista la necesitan TRES sitios:
 * el modal que la pregunta, el endpoint que la exige y la ficha que decide si
 * ofrece volver. Con una copia en cada uno, la primera corrección las desalinea
 * y el modal acaba ofreciendo un tipo que el servidor rechaza.
 *
 * Las DOS sueltan el asiento igual (borran el curso, sueltan las clases futuras y
 * dejan la entrada en `cupoHistory`). Lo único que cambia es el regreso.
 */

export type TipoSalidaCupo =
  /** Su asiento se le da a otro: no se le ofrece volver desde la ficha. */
  | 'REEMPLAZO'
  /** Puede volver con «Activar», eligiendo un salón con cupo. */
  | 'TEMPORAL';

export const TIPOS_SALIDA_CUPO: readonly TipoSalidaCupo[] = ['REEMPLAZO', 'TEMPORAL'];

/**
 * Normaliza lo que llega del cliente. Devuelve `null` para cualquier cosa que no
 * sea uno de los dos tipos — incluido el vacío, que es "no lo decidieron".
 */
export function parseTipoSalida(raw: unknown): TipoSalidaCupo | null {
  const v = String(raw ?? '').trim().toUpperCase();
  return (TIPOS_SALIDA_CUPO as readonly string[]).includes(v) ? (v as TipoSalidaCupo) : null;
}

/**
 * ¿Se le ofrece «Activar»?
 *
 * Sólo REEMPLAZO cierra la puerta. Un inactivo SIN tipo de salida —los que se
 * inactivaron antes de esta regla— conserva el botón: quitárselo los dejaría sin
 * ningún camino de vuelta desde la ficha.
 */
export function ofreceReactivar(suspenddata: { tipoSalida?: unknown } | null | undefined): boolean {
  return parseTipoSalida(suspenddata?.tipoSalida) !== 'REEMPLAZO';
}

/**
 * ¿Lo sacó un administrador a propósito?
 *
 * `estadoInactivo` NO sirve por sí solo: todo beneficiario pendiente de aprobación
 * nace inactivo. La señal es la acción de la última suspensión.
 */
export function fueInactivadoPorAdmin(suspenddata: { accion?: unknown } | null | undefined): boolean {
  return String(suspenddata?.accion ?? '').trim().toUpperCase() === 'INACTIVACION';
}
