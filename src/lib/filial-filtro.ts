/**
 * Filtro por FILIAL (PEOPLE.filial del titular) para Recaudos › Gestión.
 * `SIN_FILIAL` selecciona a los titulares que no tienen filial cargada.
 */
export const SIN_FILIAL = '__SIN_FILIAL__';

export function condicionFilial(
  filial: string | null | undefined,
  columna: string,
  paramIndex: number,
): { sql: string; params: any[] } {
  const f = (filial || '').trim();
  if (!f) return { sql: '', params: [] };
  if (f === SIN_FILIAL) return { sql: `COALESCE(TRIM(${columna}), '') = ''`, params: [] };
  return { sql: `UPPER(TRIM(${columna})) = UPPER($${paramIndex})`, params: [f] };
}
