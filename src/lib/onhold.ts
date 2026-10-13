/**
 * Reglas del OnHold (MOSAICO). Puras, cliente + servidor.
 *
 * Las fechas son días puros 'YYYY-MM-DD' (PEOPLE.fechaOnHold/fechaFinOnHold/
 * finalContrato son DATE): toda la cuenta va en UTC para que no dependa de la
 * zona del servidor ni del navegador.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' de un DATE que puede llegar como texto o como Date. */
export function fechaISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function aUTC(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** Días entre dos fechas (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((aUTC(b) - aUTC(a)) / DIA_MS);
}

export function sumarDiasISO(iso: string, dias: number): string {
  return new Date(aUTC(iso) + dias * DIA_MS).toISOString().slice(0, 10);
}

/**
 * Días que se le devuelven al contrato al salir del OnHold: los que el alumno
 * REALMENTE estuvo pausado, nunca más que el período programado.
 *
 *  - Se reactiva al vencer (o después): el período programado completo.
 *  - Se adelanta el desbloqueo: sólo hasta hoy. Antes se devolvía el período
 *    completo, así que levantar al día 10 una pausa de 90 días regalaba 80.
 *  - La pausa todavía no había empezado: 0.
 */
export function diasAExtenderOnHold(inicio: string, fin: string, hoy: string): number {
  const hasta = aUTC(hoy) < aUTC(fin) ? hoy : fin;
  return Math.max(0, diasEntre(inicio, hasta));
}
