/**
 * Helpers para derivar el estado visual del contrato a partir de los
 * campos canónicos de PEOPLE. No tocan BD — sólo cálculos.
 *
 * Diferencia clave entre `estado` y `estadoInactivo`:
 *   - `estado` = ciclo de vida del contrato (ACTIVA / On Hold /
 *     CON EXTENSION / FINALIZADA / PENDIENTE / RETRACTADO / ANULADO)
 *   - `estadoInactivo` = bandera booleana que controla acceso (login,
 *     agendamiento)
 *
 * Una persona puede estar `estadoInactivo=true` por varias razones:
 *   1. OnHold activo                → fechaOnHold IS NOT NULL
 *   2. Cron expire-contracts         → estado='FINALIZADA'
 *   3. Aprobación anulada            → estado='ANULADO'
 *   4. **Suspensión administrativa** → ninguna de las anteriores
 *      (toggle Activo/Inactivo en /person/[id] → Administración con
 *       el contrato en ACTIVA / CON EXTENSION / On Hold)
 *
 * Este helper detecta SOLO el caso 4.
 */

interface ContractStatusInput {
  estadoInactivo?: boolean | null
  fechaOnHold?: string | Date | null
  estado?: string | null
}

/**
 * `true` si la persona está suspendida administrativamente (toggle
 * Inactivo) y NO por OnHold, expiración o anulación.
 */
export function isAdminSuspended(person: ContractStatusInput | null | undefined): boolean {
  if (!person) return false
  if (person.estadoInactivo !== true) return false
  if (person.fechaOnHold)               return false
  if (person.estado === 'FINALIZADA')   return false
  if (person.estado === 'ANULADO')      return false
  return true
}
