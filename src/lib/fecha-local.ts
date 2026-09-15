/**
 * La fecha de HOY tal como la ve el navegador del usuario.
 *
 * ⚠ `new Date().toISOString()` devuelve UTC: a las 8 PM en Colombia (UTC-5) ya
 * es el día siguiente en UTC, así que usarlo para llenar un `<input type="date">`
 * o un `min` corre el día. Estas funciones leen el reloj LOCAL, que es el que
 * el usuario tiene delante.
 *
 * Vive en un solo sitio porque la usan los formularios de pago, la validación
 * del contrato y el selector de fecha del agendamiento: con una copia en cada
 * uno, la primera corrección las desalinea y un formulario acabaría aceptando
 * una fecha que otro rechaza.
 */

/** Hoy en formato `YYYY-MM-DD`, zona horaria del navegador. */
export function getLocalToday(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * ¿Esta fecha `YYYY-MM-DD` es anterior a hoy?
 *
 * Se comparan las CADENAS, no objetos `Date`: `'2026-09-14' < '2026-09-15'` es
 * cierto por orden lexicográfico y no hay zona horaria de por medio que pueda
 * correr el día. Una cadena vacía o mal formada no es "pasada" — que la rechace
 * quien valide el formato.
 */
export function esFechaPasada(yyyyMmDd: string): boolean {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return false
  return yyyyMmDd < getLocalToday()
}
