/**
 * medios-pago.ts — catálogo de "Medio de Pago" por plataforma.
 *
 * Compartido entre el wizard de Registrar Pago (`PagoTitularWizard`) y la
 * edición de pago del Centro de Validación (`PagosValidacionPanel`) para que el
 * dropdown ofrezca las mismas opciones según la plataforma del titular.
 */

export const MEDIOS_PAGO_POR_PLATAFORMA: Record<string, string[]> = {
  chile:    ['Transferencia', 'Banco Estado', 'Banco Santander', 'Paypal', 'Webpay'],
  colombia: ['Transferencia', 'Bancolombia', 'EPAYCO', 'Paypal'],
  ecuador:  ['Transferencia', 'Banco Pichincha', 'Banco Guayaquil', 'Banco del Barrio / Guayaquil', 'Paypal', 'Datafast'],
  peru:     ['Transferencia', 'Banco BBVA Academic', 'Banco BBVA Rel', 'Paypal', 'Niubiz'],
};

/** Normaliza la plataforma para el lookup (sin acentos, minúsculas): "Perú" → "peru". */
export function normPlataforma(p?: string): string {
  return (p || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Opciones de "Medio de Pago" según la plataforma. Si no matchea ninguna
 * conocida, devuelve la unión de todas (fallback) para no dejar el dropdown vacío.
 */
export function mediosPagoPara(plataforma?: string): string[] {
  return (
    MEDIOS_PAGO_POR_PLATAFORMA[normPlataforma(plataforma)] ??
    Array.from(new Set(Object.values(MEDIOS_PAGO_POR_PLATAFORMA).flat()))
  );
}
