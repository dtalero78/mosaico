/**
 * Helper SQL para excluir contratos de prueba (prefijo PRB-) de informes.
 *
 * Patrón único: NOT EXISTS contra PEOPLE por `numeroId`. Asumimos que la
 * tabla base del informe (ACADEMICA_BOOKINGS, ACADEMICA, etc.) tiene una
 * columna `numeroId` directa o vía alias.
 *
 * Ejemplo:
 *   const SQL_EXCLUYE_PRB_BY_NUMID = excluyePruebaPorNumeroId('b');
 *   `... WHERE ... AND ${SQL_EXCLUYE_PRB_BY_NUMID}`
 *
 * Genera:
 *   AND NOT EXISTS (
 *     SELECT 1 FROM "PEOPLE" pp_prb
 *     WHERE pp_prb."numeroId" = b."numeroId"
 *       AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
 *   )
 *
 * Para tablas que SÍ tienen `contrato` directamente (PEOPLE, FINANCIEROS,
 * USUARIOS_ROLES) usa directamente: `AND COALESCE(<alias>."contrato",'') NOT LIKE 'PRB-%'`.
 */
export function excluyePruebaPorNumeroId(aliasConNumeroId: string): string {
  const a = aliasConNumeroId.replace(/[^a-zA-Z0-9_]/g, '');
  return `NOT EXISTS (
    SELECT 1 FROM "PEOPLE" pp_prb
    WHERE pp_prb."numeroId" = ${a}."numeroId"
      AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
  )`;
}
