/**
 * Admin Event Window — reglas de ventana temporal para REGISTRAR eventos
 * administrativos del advisor.
 *
 * Diferencia con `session-window.ts` (sesiones académicas):
 *   - No hay "ventana de asistencia" (no hay estudiantes — solo registro de horas)
 *   - Apertura de registro a +40 min (no +30)
 *   - Cierre de ventana a +120 min (igual)
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 0min            +40min                +120min                │
 *   │  │                │                      │                   │
 *   │  │              ├──> Registrar ────────┤                     │
 *   │  │                                       │                   │
 *   │  ├──── COORDINADOR / ADMIN: siempre ─────────────────────────┤
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Bypass total: COORDINADOR_ACADEMICO, SUPER_ADMIN, ADMIN.
 * Cliente Y servidor (no `'server-only'`).
 */

export const ADMIN_REGISTER_OPEN_MIN  = 40;
export const ADMIN_REGISTER_CLOSE_MIN = 120;

const BYPASS_ROLES = new Set(['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN']);

export interface AdminEventWindowState {
  isCoordinator: boolean;
  canRegister: boolean;
  isExpired: boolean;
  minutesElapsed: number;
  minutesUntilRegister: number | null;
  minutesUntilExpire: number | null;
}

export function getAdminEventWindow(
  fechaInicio: Date | string | null | undefined,
  role: string | null | undefined,
  now: Date = new Date(),
): AdminEventWindowState {
  const isCoordinator = BYPASS_ROLES.has(String(role || '').toUpperCase());

  if (!fechaInicio) {
    return {
      isCoordinator,
      canRegister: isCoordinator,
      isExpired: false,
      minutesElapsed: 0,
      minutesUntilRegister: null,
      minutesUntilExpire: null,
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
    };
  }

  const elapsedMs = now.getTime() - startMs;
  const minutesElapsed = Math.floor(elapsedMs / 60_000);

  const inRegisterWindow = minutesElapsed >= ADMIN_REGISTER_OPEN_MIN && minutesElapsed <= ADMIN_REGISTER_CLOSE_MIN;
  const expired          = minutesElapsed > ADMIN_REGISTER_CLOSE_MIN;

  const minutesUntilRegister = !isCoordinator && minutesElapsed < ADMIN_REGISTER_OPEN_MIN
    ? ADMIN_REGISTER_OPEN_MIN - minutesElapsed
    : null;
  const minutesUntilExpire = !isCoordinator && minutesElapsed >= ADMIN_REGISTER_OPEN_MIN && minutesElapsed <= ADMIN_REGISTER_CLOSE_MIN
    ? ADMIN_REGISTER_CLOSE_MIN - minutesElapsed
    : null;

  return {
    isCoordinator,
    canRegister: isCoordinator || inRegisterWindow,
    isExpired:   !isCoordinator && expired,
    minutesElapsed,
    minutesUntilRegister,
    minutesUntilExpire,
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
