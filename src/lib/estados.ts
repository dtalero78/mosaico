/**
 * Vocabulario de estados del contrato.
 *
 * Los estados se comparaban contra el literal, archivo por archivo: 65 veces en
 * 28 archivos sólo para `'Aprobado'`. El problema no es la repetición sino que
 * SIETE de esas comparaciones arrastraban además `'Aprobada'` —herencia de LGS—
 * y las otras no. Un valor con dos grafías repartido a mano es una bomba de
 * relojería: basta que alguien copie la comparación corta para que un titular
 * deje de aparecer en un informe sin que nadie lo note.
 *
 * `'Aprobada'` NO existe en MOSAICO: se comprobó columna por columna en toda la
 * base y da 0 filas. Se retira de las comparaciones y queda sólo en
 * `APROBACION_APROBADO_LEGACY`, para que quien vuelva a encontrársela sepa de
 * dónde salía.
 *
 * Módulo de cliente + servidor: lo usan servicios, endpoints y componentes.
 */

// ─── Aprobación (decisión comercial sobre el contrato) ──────────────────────

/** Valores reales de `PEOPLE.aprobacion` en MOSAICO. */
export const APROBACION = {
  APROBADO: 'Aprobado',
  PENDIENTE: 'Pendiente',
  DEVUELTO: 'Devuelto',
  RECHAZADO: 'Rechazado',
  RETRACTADO: 'Retractado',
  CONTRATO_NULO: 'Contrato nulo',
  FINALIZADA: 'FINALIZADA',
} as const;

export type Aprobacion = typeof APROBACION[keyof typeof APROBACION];

/**
 * La grafía femenina que llegó de LGS. Cero filas en MOSAICO — se conserva sólo
 * para poder tolerarla al LEER datos que vinieran de allá.
 */
export const APROBACION_APROBADO_LEGACY = 'Aprobada';

/** ¿El contrato está aprobado? Tolera la grafía legacy al leer. */
export function esAprobado(valor: string | null | undefined): boolean {
  const v = String(valor ?? '').trim();
  return v === APROBACION.APROBADO || v === APROBACION_APROBADO_LEGACY;
}

/**
 * Fragmento SQL equivalente a `esAprobado`, para los WHERE.
 *
 * Se mantiene el `IN` con la grafía legacy: en SQL cuesta lo mismo y cubre el
 * caso de que alguna vez entre un dato migrado. Lo que se gana es que la lista
 * esté escrita UNA vez.
 *
 * @param col expresión de la columna, ya entrecomillada (ej. `p."aprobacion"`)
 */
export function esAprobadoSql(col: string): string {
  return `${col} IN ('${APROBACION.APROBADO}', '${APROBACION_APROBADO_LEGACY}')`;
}

// ─── Estado operativo del contrato ──────────────────────────────────────────

/** Valores reales de `PEOPLE.estado`. */
export const ESTADO = {
  ACTIVA: 'ACTIVA',
  PENDIENTE: 'PENDIENTE',
  RETRACTADO: 'RETRACTADO',
  ANULADO: 'ANULADO',
  ON_HOLD: 'On Hold',
  CON_EXTENSION: 'CON EXTENSION',
  FINALIZADA: 'FINALIZADA',
} as const;

export type Estado = typeof ESTADO[keyof typeof ESTADO];

// ─── Tipo de persona ────────────────────────────────────────────────────────

export const TIPO_USUARIO = {
  TITULAR: 'TITULAR',
  BENEFICIARIO: 'BENEFICIARIO',
} as const;

export type TipoUsuario = typeof TIPO_USUARIO[keyof typeof TIPO_USUARIO];
