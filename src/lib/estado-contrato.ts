/**
 * Estado del contrato PARA MOSTRAR (cliente + servidor — sin `server-only`).
 *
 * La zona "todavía sin decidir" se desdobla en dos, porque son momentos
 * distintos del proceso y hasta ahora se veían iguales:
 *
 *   En Gestión  → Comercial aún no cerró el contrato. Su curso y horario están
 *                 guardados pero el cupo del salón **no está reservado**.
 *   Pendiente   → Comercial ya lo dejó listo (el cupo quedó tomado) y espera
 *                 la aprobación.
 *
 * ⚠ "En Gestión" es un valor DERIVADO, no se guarda: sale de
 * `PEOPLE.gestionContratoListo`. La columna `aprobacion` sigue siendo la que
 * manda en las reglas de negocio (liberación de cupo, aprobación), así que
 * meterle un valor nuevo habría obligado a tocar todas esas reglas.
 *
 * El resto de estados (Aprobado, Devuelto, Rechazado, Retractado, Contrato
 * nulo, FINALIZADA) se muestran tal cual: ahí ya hubo una decisión.
 */

export const ESTADO_EN_GESTION = 'En Gestión';
export const ESTADO_PENDIENTE = 'Pendiente';

/** Estados en los que el contrato aún no tiene una decisión tomada. */
const SIN_DECIDIR = ['', 'pendiente'];

export function estadoContratoTitular(
  aprobacion: string | null | undefined,
  gestionContratoListo: boolean | null | undefined
): string {
  const crudo = String(aprobacion ?? '').trim();
  if (!SIN_DECIDIR.includes(crudo.toLowerCase())) return crudo;
  return gestionContratoListo === true ? ESTADO_PENDIENTE : ESTADO_EN_GESTION;
}

/** Clase del badge por estado, igual en todas las pantallas. */
export function estadoContratoBadgeClass(estado: string): string {
  switch (estado) {
    case 'Aprobado':
    case 'Aprobada':
      return 'badge-success';
    case ESTADO_PENDIENTE:
      return 'badge-warning';
    case ESTADO_EN_GESTION:
      return 'bg-sky-100 text-sky-700';
    case 'Rechazado':
    case 'Eliminado':
      return 'badge-danger';
    case 'Inactivo':
      return 'badge-secondary';
    default:
      return 'badge-info';
  }
}
