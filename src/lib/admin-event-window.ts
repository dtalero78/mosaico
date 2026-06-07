/**
 * Admin Event Window — reglas de ventana temporal para REGISTRAR eventos
 * administrativos del advisor.
 *
 * La ventana ESCALA con la duración nominal (`horas`) del evento:
 *   - Apertura: cuando el evento termina nominalmente (`fechaInicio + horas*60min`).
 *     El advisor no puede registrar antes — la duración cobrada al advisor
 *     debe corresponder a la duración real.
 *   - Cierre: +90 min después del fin nominal.
 *
 * Ejemplos:
 *
 *   horas=1 (evento 8:00–9:00):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 0min          +60min (fin)              +150min          │
 *   │                │                          │              │
 *   │              ├──> Registrar ────────────┤                │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   horas=3 (evento 8:00–11:00):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 0min                +180min (fin)         +270min        │
 *   │                      │                       │           │
 *   │                    ├──> Registrar ─────────┤             │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Bypass total: COORDINADOR_ACADEMICO, SUPER_ADMIN, ADMIN — pueden registrar
 * en cualquier momento (antes, durante o después del fin nominal).
 *
 * Defensa: si no recibimos `horas`, usamos 1 como fallback.
 * Cliente Y servidor (no `'server-only'`).
 */

/** Margen post-fin: cuánto tiempo después del fin nominal queda abierta la ventana. */
export const ADMIN_REGISTER_GRACE_MIN = 90;

const BYPASS_ROLES = new Set(['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN']);

export interface AdminEventWindowState {
  isCoordinator: boolean;
  canRegister: boolean;
  isExpired: boolean;
  minutesElapsed: number;
  minutesUntilRegister: number | null;
  minutesUntilExpire: number | null;
  /** Minuto del fin nominal del evento (`horas*60`). Útil para mensajes UI. */
  finNominalMin: number;
}

export function getAdminEventWindow(
  fechaInicio: Date | string | null | undefined,
  role: string | null | undefined,
  now: Date = new Date(),
  horas?: number | null,
): AdminEventWindowState {
  const isCoordinator = BYPASS_ROLES.has(String(role || '').toUpperCase());
  const horasNum = typeof horas === 'number' && horas > 0 ? Math.floor(horas) : 1;
  const finNominalMin = horasNum * 60;

  if (!fechaInicio) {
    return {
      isCoordinator,
      canRegister: isCoordinator,
      isExpired: false,
      minutesElapsed: 0,
      minutesUntilRegister: null,
      minutesUntilExpire: null,
      finNominalMin,
    };
  }

  const startMs = (fechaInicio instanceof Date ? fechaInicio : new Date(fechaInicio)).getTime();
  if (Number.isNaN(startMs)) {
    return {
      isCoordinator,
      canRegister: isCoordinator,
      isExpired: false,
      minutesElapsed: 0,
      minutesUntilRegister: null,
      minutesUntilExpire: null,
      finNominalMin,
    };
  }

  const elapsedMs = now.getTime() - startMs;
  const minutesElapsed = Math.floor(elapsedMs / 60_000);

  const openMin  = finNominalMin;
  const closeMin = finNominalMin + ADMIN_REGISTER_GRACE_MIN;

  const inRegisterWindow = minutesElapsed >= openMin && minutesElapsed <= closeMin;
  const expired          = minutesElapsed > closeMin;

  const minutesUntilRegister = !isCoordinator && minutesElapsed < openMin
    ? openMin - minutesElapsed
    : null;
  const minutesUntilExpire = !isCoordinator && minutesElapsed >= openMin && minutesElapsed <= closeMin
    ? closeMin - minutesElapsed
    : null;

  return {
    isCoordinator,
    canRegister: isCoordinator || inRegisterWindow,
    isExpired:   !isCoordinator && expired,
    minutesElapsed,
    minutesUntilRegister,
    minutesUntilExpire,
    finNominalMin,
  };
}

export const ADMIN_EVENT_EXPIRED_MESSAGE =
  'Período de registro vencido. Contacta al Coordinador Académico para registrar este evento administrativo.';

/** Tipos válidos — mismo set que el CHECK constraint de BD. */
export const ADMIN_EVENT_TIPOS = ['TRAINING', 'SUPPORT', 'OBSERVATION', 'MEETING', 'DEVELOPMENT'] as const;
export type AdminEventTipo = typeof ADMIN_EVENT_TIPOS[number];

/** Label visual + color para cada tipo (compartido entre páginas). */
export const ADMIN_EVENT_TIPO_META: Record<AdminEventTipo, { label: string; color: string; textColor: string }> = {
  TRAINING:    { label: 'Training',    color: 'bg-violet-100 border-violet-300', textColor: 'text-violet-800' },
  SUPPORT:     { label: 'Support',     color: 'bg-sky-100    border-sky-300',    textColor: 'text-sky-800' },
  OBSERVATION: { label: 'Observation', color: 'bg-teal-100   border-teal-300',   textColor: 'text-teal-800' },
  MEETING:     { label: 'Meeting',     color: 'bg-slate-100  border-slate-300',  textColor: 'text-slate-800' },
  DEVELOPMENT: { label: 'Development', color: 'bg-fuchsia-100 border-fuchsia-300', textColor: 'text-fuchsia-800' },
};
