/**
 * Factura "ADMIN" — el número de factura que se pone a un pago que se factura
 * sin número propio (Centro de Validación › Facturación, en bloque).
 *
 * Es el único valor que puede repetirse dentro de un lote: los números reales
 * siguen sin poder repetirse. Vive aquí (cliente y servidor) para que la casilla
 * de la pantalla y la validación del servidor usen la misma palabra.
 */
export const FACTURA_ADMIN = 'ADMIN'

export function esFacturaAdmin(numero: string | null | undefined): boolean {
  return String(numero || '').trim().toUpperCase() === FACTURA_ADMIN
}
