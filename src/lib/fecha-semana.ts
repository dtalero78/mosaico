/**
 * Fin de la SEMANA SIGUIENTE (domingo, 23:59:59.999) tomando `base` como "hoy".
 *
 * Se usa para acotar las listas de clases: se muestran TODOS los eventos pasados +
 * sólo los pendientes hasta el domingo de la semana siguiente (2 semanas lunes-domingo:
 * la semana en curso + la siguiente). Cliente-safe (sin imports de servidor).
 */
export function finSemanaSiguiente(base: Date = new Date()): Date {
  const n = new Date(base);
  const diasAlDomingo = (7 - n.getDay()) % 7; // 0 = hoy es domingo
  const fin = new Date(n);
  fin.setDate(n.getDate() + diasAlDomingo + 7); // domingo de la semana siguiente
  fin.setHours(23, 59, 59, 999);
  return fin;
}

/**
 * ¿La clase debe mostrarse? Regla MOSAICO para tablas de asistencia/historial:
 *  - pasada (fecha <= ahora): siempre.
 *  - futura: sólo si cae hasta el fin de la semana siguiente.
 * Si no hay fecha, se muestra (no se puede acotar).
 */
export function visibleEnHistorial(fechaEvento: any, ahora: Date = new Date(), fin: Date = finSemanaSiguiente(ahora)): boolean {
  if (!fechaEvento) return true;
  const d = new Date(fechaEvento);
  if (isNaN(d.getTime())) return true;
  if (d.getTime() <= ahora.getTime()) return true; // pasada → siempre
  return d.getTime() <= fin.getTime();             // futura → sólo hasta fin de la próxima semana
}
