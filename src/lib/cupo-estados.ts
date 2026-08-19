/**
 * Estados del CONTRATO que liberan el cupo (cliente + servidor).
 *
 * El estado del contrato vive en el `aprobacion` del TITULAR, no en el de cada
 * beneficiario: el contrato es uno solo. El `aprobacion` del beneficiario dice
 * otra cosa — si a ESA persona se le dio de alta— y por eso sólo vale
 * `Aprobado` o vacío. Copiar el estado del contrato a cada beneficiario
 * duplicaría un mismo hecho en N filas, que es como se desincronizan.
 *
 * Vive aparte de `lib/cupo.ts` (que es `server-only` por el SQL) para que la
 * ficha de la persona pueda decidir con el MISMO criterio qué mostrar y qué
 * habilitar, en vez de tener su propia copia.
 */

/** Estados (normalizados) del titular que sueltan el asiento del salón. */
export const ESTADOS_LIBERAN_CUPO = ['devuelto', 'rechazado', 'retractado', 'contrato nulo'] as const;

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** ¿El contrato, por su estado, sigue reteniendo el cupo de sus alumnos? */
export function contratoRetieneCupo(aprobacionTitular: unknown): boolean {
  return !(ESTADOS_LIBERAN_CUPO as readonly string[]).includes(norm(aprobacionTitular));
}

/** Etiqueta de por qué el contrato soltó el cupo (para explicarlo en pantalla). */
export function motivoLiberadoPorContrato(aprobacionTitular: unknown): string | null {
  const v = norm(aprobacionTitular);
  if (!(ESTADOS_LIBERAN_CUPO as readonly string[]).includes(v)) return null;
  return `el contrato está ${String(aprobacionTitular).trim()}`;
}
