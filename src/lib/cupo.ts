import 'server-only';

/**
 * Regla de CUPOS de salón (MOSAICO). El cupo es POR SALÓN: cada fila de
 * CURSOS_CAMPAIGN es un salón con su propio `numeroUsuarios`.
 *
 * Un beneficiario OCUPA un cupo desde que Comercial marca el contrato como
 * **listo** en Gestión Contrato (`cupoConfirmado`), y lo mantiene **sólo
 * mientras el contrato esté Pendiente o Aprobado**. En cuanto pasa a CUALQUIER
 * otro estado el cupo se libera **solo**, sin tocar nada a mano: la regla se
 * evalúa al leer, así que el salón queda disponible en el mismo instante en que
 * se cambia el estado.
 *
 * ⚠ Al CREAR el contrato el curso se guarda pero el cupo **no se reserva**
 * (`cupoConfirmado=false`): la asignación es provisional hasta que se marque
 * listo, que es cuando se comprueba que el salón todavía tiene lugar. Ver
 * `gestion-cupo.service.ts`. Antes se reservaba en el instante de crear, y un
 * contrato que nunca se cerraba dejaba el asiento bloqueado.
 *
 * El cupo se **libera** cuando:
 *  - el contrato deja de estar Pendiente/Aprobado, es decir queda **Devuelto,
 *    Rechazado, Retractado o Contrato nulo** (estados que viven en el
 *    `aprobacion` del TITULAR — el beneficiario solo tiene Aprobado/Pendiente), o
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

/**
 * Estados del contrato (TITULAR.aprobacion, normalizados) que LIBERAN el cupo.
 * Es el complemento de "Pendiente o Aprobado": cualquier otro estado lo libera.
 * `Devuelto` entró en agosto-2026 — antes retenía el cupo, y un contrato devuelto
 * dejaba el salón bloqueado sin que nadie estuviera ocupándolo.
 */
export { ESTADOS_LIBERAN_CUPO } from './cupo-estados';
import { ESTADOS_LIBERAN_CUPO } from './cupo-estados';

/**
 * Fragmento SQL booleano: TRUE si el beneficiario con alias `<alias>` OCUPA cupo,
 * es decir, su contrato (titular) NO está en un estado liberador.
 * `alias` es el alias de la fila PEOPLE (beneficiario) en la query que lo invoca.
 */
/**
 * Minutos que dura la reserva temporal del cupo al crear el contrato. Pasado ese
 * plazo el asiento se suelta SOLO: la ocupación se calcula al leer, así que la
 * reserva caduca por su propia fecha — no hay cron que la limpie.
 */
export const RESERVA_CUPO_MIN = 60;

export function cupoOcupadoSql(alias: string): string {
  return `((${alias}."cupoConfirmado" IS TRUE OR ${alias}."cupoReservadoHasta" > NOW())
    AND ${alias}."fechaOnHold" IS NULL
    AND ${alias}."cupoLiberado" IS NOT TRUE
    AND NOT (${alias}."estadoInactivo" IS TRUE AND COALESCE(${alias}."suspenddata"->>'accion', '') = 'INACTIVACION')
    AND NOT EXISTS (
    SELECT 1 FROM "PEOPLE" t_cupo
     WHERE t_cupo."contrato" = ${alias}."contrato"
       AND t_cupo."tipoUsuario" = 'TITULAR'
       AND LOWER(TRIM(COALESCE(t_cupo."aprobacion", ''))) IN (${ESTADOS_LIBERAN_CUPO.map(e => `'${e}'`).join(', ')})))`;
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
