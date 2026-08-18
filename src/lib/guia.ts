/**
 * ¿Hay un guía REALMENTE asignado a un curso?
 *
 * Un curso sin guía no puede chocar con nada: no hay una persona a la que se le
 * solapen dos clases. Pero «sin guía» no es sólo NULL — también cuenta la cadena
 * vacía y, sobre todo, **el texto literal `"null"`/`"undefined"`**, que es lo que
 * llega cuando el formulario manda un valor no elegido convertido a cadena.
 *
 * En la base había un curso guardado así (`0CTUBRE192026M · YOJI · Salón 7`) y
 * para el código anterior eso no era «sin guía»: era un guía cuyo id es «null».
 * Cualquier curso nuevo sin guía lo encontraba y sacaba el aviso de colisión.
 *
 * Vive en `lib/` y no en el servicio porque es una regla pura: así la pueden usar
 * los endpoints, los scripts de diagnóstico y los tests sin arrastrar la conexión
 * a la base.
 *
 * NO comprueba que el id exista en GUIAS — eso necesita la base y se hace en
 * `detectarColisionesGuia`, que sólo cuenta como colisión al guía que ESTÁ en la
 * lista de guías.
 */

/** Valores que significan «no hay guía», más allá de NULL y la cadena vacía. */
const SIN_GUIA = ['null', 'undefined', 'none', '-'];

/** Devuelve el id del guía asignado, o `null` si no hay ninguno. */
export function guiaAsignado(guia: string | null | undefined): string | null {
  const g = String(guia ?? '').trim();
  if (!g) return null;
  if (SIN_GUIA.includes(g.toLowerCase())) return null;
  return g;
}
