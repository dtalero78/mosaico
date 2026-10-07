/**
 * Vigencia del contrato en Crear Contrato (cliente + servidor).
 *
 * Un contrato "Módulo" dura siempre VIGENCIA_MODULO meses (el campo queda
 * bloqueado); uno que no es módulo admite de VIGENCIA_MIN a VIGENCIA_MAX meses.
 * La regla vive aquí porque la usan el wizard y la validación del endpoint: con
 * dos copias, el formulario acabaría aceptando lo que el servidor rechaza.
 */
export const VIGENCIA_MODULO = 3;
export const VIGENCIA_MIN = 3;
export const VIGENCIA_MAX = 9;

/** ¿La vigencia (en meses) es válida para un contrato módulo / no módulo? */
export function vigenciaValida(vigencia: unknown, modulo: boolean): boolean {
  const txt = String(vigencia ?? '').trim();
  if (!/^\d+$/.test(txt)) return false;
  const n = Number(txt);
  if (modulo) return n === VIGENCIA_MODULO;
  return n >= VIGENCIA_MIN && n <= VIGENCIA_MAX;
}

export function mensajeVigenciaInvalida(modulo: boolean): string {
  return modulo
    ? `Un contrato Módulo tiene una vigencia fija de ${VIGENCIA_MODULO} meses.`
    : `La vigencia debe estar entre ${VIGENCIA_MIN} y ${VIGENCIA_MAX} meses.`;
}
