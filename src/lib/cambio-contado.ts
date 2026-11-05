/**
 * cambio-contado.ts — regla de atribución del "Cambio Contado".
 *
 * Cuando un pago se marca como **Cambio Contado**, se registra QUIÉN gestionó
 * ese cambio (`PAGOS_TITULARES.realizadopor`) según cuánto tiempo pasó entre la
 * **creación del contrato** y el pago:
 *
 *   pago dentro de los 30 días de creado el contrato → 'Comercial'  (venta original)
 *   pago después de los 30 días                      → 'Recaudos'   (gestión de cobranza)
 *
 * Un pago ANTERIOR a la fecha base también es 'Comercial' (sigue siendo la venta).
 *
 * Client-safe a propósito (sin `server-only`): el wizard lo usa para mostrar el
 * valor en vivo antes de guardar y el servicio para calcular el valor REAL que
 * se persiste. El servidor es la autoridad — nunca se confía en lo que manda el
 * cliente, que solo lo ve como vista previa.
 */

/** Días desde la creación del contrato dentro de los cuales el cambio se atribuye a Comercial. */
export const VENTANA_COMERCIAL_DIAS = 30;

export type RealizadoPor = 'Comercial' | 'Recaudos';

/** Valores aceptados en BD (`realizadopor`). */
export const REALIZADO_POR_VALIDOS: readonly RealizadoPor[] = ['Comercial', 'Recaudos'];

/**
 * Fecha base del contrato = **fecha de creación del contrato** (`_createdDate`),
 * con respaldo en cascada a las fechas del contrato si faltara.
 *
 * Se usa la creación del contrato (presente en el 100% de los registros) como
 * ancla de la ventana Comercial/Recaudos. Los respaldos (inicio/fecha del
 * contrato y, por último, la aprobación) solo aplican si `_createdDate` viniera
 * vacío.
 */
export function fechaBaseContrato(titular: {
  _createdDate?: string | Date | null;
  inicioContrato?: string | Date | null;
  fechaContrato?: string | Date | null;
  fechaIngreso?: string | Date | null;
}): string | null {
  const candidatos = [
    titular?._createdDate,
    titular?.inicioContrato,
    titular?.fechaContrato,
    titular?.fechaIngreso,
  ];
  for (const c of candidatos) {
    const d = toYMD(c);
    if (d) return d;
  }
  return null;
}

/** Normaliza a 'YYYY-MM-DD'. Acepta Date, ISO completo o fecha pura. */
function toYMD(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/** 'YYYY-MM-DD' → epoch UTC de medianoche. Comparación libre de zona horaria. */
function utcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Días calendario entre la fecha base del contrato (creación) y la del pago.
 * Negativo si el pago es anterior a la base. `null` si falta alguna fecha.
 */
export function diasDesdeBase(
  fechaBase: string | Date | null | undefined,
  fechaPago: string | Date | null | undefined,
): number | null {
  const base = toYMD(fechaBase);
  const pago = toYMD(fechaPago);
  if (!base || !pago) return null;
  return Math.round((utcMs(pago) - utcMs(base)) / 86_400_000);
}

/**
 * Resuelve `realizadopor`. Devuelve `null` cuando no hay fecha base con la cual
 * comparar — preferimos dejar el campo vacío antes que atribuirlo a ciegas.
 */
export function resolveRealizadoPor(
  fechaBase: string | Date | null | undefined,
  fechaPago: string | Date | null | undefined,
): RealizadoPor | null {
  const dias = diasDesdeBase(fechaBase, fechaPago);
  if (dias === null) return null;
  return dias <= VENTANA_COMERCIAL_DIAS ? 'Comercial' : 'Recaudos';
}
