import 'server-only';

/**
 * Regla de CUPOS de curso (MOSAICO).
 *
 * Un beneficiario OCUPA un cupo desde que se crea el contrato y lo mantiene mientras
 * el contrato esté **Pendiente, Devuelto o Aprobado**. El cupo se **libera** cuando:
 *  - el contrato queda **Rechazado, Retractado o Contrato nulo** (estados que viven en
 *    el `aprobacion` del TITULAR — el beneficiario solo tiene Aprobado/Pendiente), o
 *  - el beneficiario está en **OnHold** (`fechaOnHold` seteada): se conserva su
 *    campaña/curso/salón pero deja de ocupar cupo hasta que se restablezca, o
 *  - el beneficiario fue **INACTIVADO por un admin** (botón "Inactivar" de la ficha →
 *    `estadoInactivo=true` + `suspenddata.accion='INACTIVACION'`): normalmente porque
 *    el usuario NO tomará el curso, así que su cupo se libera, o
 *  - un admin **liberó el cupo a mano** (`cupoLiberado=true`, botón "Cupo asignado"
 *    de la ficha): abre el cupo sin inactivar al beneficiario ni tocar el contrato.
 *    Con el contrato APROBADO esa liberación no se permite (se valida en el endpoint).
 *
 * ⚠ NO se usa `estadoInactivo` a secas: un beneficiario **Pendiente nace inactivo**
 * (aún no aprobado) pero SÍ ocupa cupo. Sólo libera cuando además hay `suspenddata`
 * de INACTIVACION (la misma señal del badge "SUSPENDIDA"), lo que distingue "inactivado
 * a propósito por un admin" de "recién creado y pendiente de aprobar".
 */

/** Estados del contrato (TITULAR.aprobacion, normalizados) que LIBERAN el cupo. */
export const ESTADOS_LIBERAN_CUPO = ['rechazado', 'retractado', 'contrato nulo'] as const;

/**
 * Fragmento SQL booleano: TRUE si el beneficiario con alias `<alias>` OCUPA cupo,
 * es decir, su contrato (titular) NO está en un estado liberador.
 * `alias` es el alias de la fila PEOPLE (beneficiario) en la query que lo invoca.
 */
export function cupoOcupadoSql(alias: string): string {
  return `(${alias}."fechaOnHold" IS NULL
    AND ${alias}."cupoLiberado" IS NOT TRUE
    AND NOT (${alias}."estadoInactivo" IS TRUE AND COALESCE(${alias}."suspenddata"->>'accion', '') = 'INACTIVACION')
    AND NOT EXISTS (
    SELECT 1 FROM "PEOPLE" t_cupo
     WHERE t_cupo."contrato" = ${alias}."contrato"
       AND t_cupo."tipoUsuario" = 'TITULAR'
       AND LOWER(TRIM(COALESCE(t_cupo."aprobacion", ''))) IN ('rechazado', 'retractado', 'contrato nulo')))`;
}

/**
 * Estado del contrato para MOSTRAR en el listado de inscritos, a partir del
 * `aprobacion` del titular y del beneficiario. Solo para display.
 */
export function estadoContratoDisplay(aprobTitular: string | null, aprobBenef: string | null): string {
  const t = String(aprobTitular || '').trim().toLowerCase();
  if (t === 'rechazado') return 'Rechazado';
  if (t === 'retractado') return 'Retractado';
  if (t === 'contrato nulo') return 'Contrato nulo';
  const b = String(aprobBenef || '').trim().toLowerCase();
  if (b === 'aprobado' || b === 'aprobada') return 'Aprobado';
  if (t === 'devuelto') return 'Devuelto';
  return 'Pendiente';
}
