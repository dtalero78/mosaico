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

/**
 * Medios de pago del CONTRATO (paso Financiero de Crear Contrato, Migrar
 * Contrato y el botón «InfoFinanciera» del detalle del contrato). Es un catálogo
 * distinto del de Recaudos de arriba: el contrato dice CÓMO se pactó pagar; el
 * de Recaudos, por qué banco entró cada pago. Estaba copiado en Crear Contrato y
 * Migrar Contrato.
 */
export const MEDIOS_PAGO_CONTRATO: Record<string, { label: string; value: string }[]> = {
  'Colombia': [
    { label: 'Transferencia', value: 'Transferencia' },
    { label: 'Epayco', value: 'Epayco' },
    { label: 'Paypal', value: 'Paypal' },
  ],
  'Ecuador': [
    { label: 'Transferencia', value: 'Transferencia' },
    { label: 'Datafast', value: 'Datafast' },
    { label: 'Paypal', value: 'Paypal' },
  ],
  'Chile': [
    { label: 'Transferencia', value: 'Transferencia' },
    { label: 'Webpay', value: 'Webpay' },
    { label: 'Paypal', value: 'Paypal' },
  ],
  'Perú': [
    { label: 'Transferencia', value: 'Transferencia' },
    { label: 'Niubiz', value: 'Niubiz' },
  ],
};

/** Opciones del contrato para un país; sin país conocido, las de Colombia (comportamiento previo). */
export function mediosPagoContrato(pais?: string | null): { label: string; value: string }[] {
  return MEDIOS_PAGO_CONTRATO[String(pais || '')] || MEDIOS_PAGO_CONTRATO['Colombia'];
}
