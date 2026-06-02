/**
 * Session Window — reglas de ventana temporal para registrar asistencia y
 * cerrar sesiones en `/sesion/[id]`.
 *
 * Ventanas (relativas a `CALENDARIO.dia` = inicio del evento, ambos extremos
 * inclusivos):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 0min          +30min                +120min                  │
 *   │  │              │                      │                     │
 *   │  ├── Marcar asistencia (ADVISOR) ─────┤                     │
 *   │  │                                    │                     │
 *   │  │            ├── Registrar Sesión ──┤                      │
 *   │  │                                    │                     │
 *   │  ├──── COORDINADOR / ADMIN: siempre ───────────────────────┤
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Bypass total (sin ventanas): COORDINADOR_ACADEMICO, SUPER_ADMIN, ADMIN.
 * Mismo helper se importa en cliente y servidor → la UI muestra lo mismo
 * que el endpoint permite.
 *
 * NO importar `'server-only'` — esto vive en ambos lados.
 */

export const ATTENDANCE_WINDOW_MIN = 120;  // 0 .. +120 min
export const REGISTER_OPEN_MIN     = 30;   // +30 .. +120 min
export const REGISTER_CLOSE_MIN    = 120;

/** Roles que NO están atados a ventanas temporales. */
const BYPASS_ROLES = new Set(['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN']);

export interface SessionWindowState {
  /** El rol del que actúa puede ignorar todas las ventanas. */
  isCoordinator: boolean;
  /** ¿Se puede marcar asistencia AHORA? */
  canMarkAttendance: boolean;
  /** ¿Se puede registrar (Time Out + cerrar sesión) AHORA? */
  canRegister: boolean;
  /** ¿La ventana del advisor ya venció (>+120min, no cerrado)? */
  isExpired: boolean;
  /** Min transcurridos desde `fechaEvento`. Puede ser negativo (evento futuro). */
  minutesElapsed: number;
  /** Min hasta que se habilite Registrar Sesión. Null si ya está habilitado o expiró. */
  minutesUntilRegister: number | null;
  /** Min hasta que expire la ventana. Null si ya expiró o coordinador. */
  minutesUntilExpire: number | null;
}

/**
 * Calcula el estado de la ventana para un evento dado.
 *
 * @param fechaEvento — `CALENDARIO.dia` (inicio del evento)
 * @param now        — hora actual (default: Date.now)
 * @param role       — rol del usuario actual (de la sesión NextAuth)
 */
export function getSessionWindow(
  fechaEvento: Date | string | null | undefined,
  role: string | null | undefined,
  now: Date = new Date(),
): SessionWindowState {
  const isCoordinator = BYPASS_ROLES.has(String(role || '').toUpperCase());

  // Sin fecha de evento — no se puede calcular nada. Coordinador puede igual.
  if (!fechaEvento) {
    return {
      isCoordinator,
      canMarkAttendance: isCoordinator,
      canRegister:       isCoordinator,
      isExpired: false,
      minutesElapsed: 0,
      minutesUntilRegister: null,
      minutesUntilExpire: null,
    };
  }

  const startMs = (fechaEvento instanceof Date ? fechaEvento : new Date(fechaEvento)).getTime();
  if (Number.isNaN(startMs)) {
    return {
      isCoordinator,
      canMarkAttendance: isCoordinator,
      canRegister:       isCoordinator,
      isExpired: false,
      minutesElapsed: 0,
      minutesUntilRegister: null,
      minutesUntilExpire: null,
    };
  }

  const elapsedMs = now.getTime() - startMs;
  const minutesElapsed = Math.floor(elapsedMs / 60_000);

  const inAttendanceWindow = minutesElapsed >= 0 && minutesElapsed <= ATTENDANCE_WINDOW_MIN;
  const inRegisterWindow   = minutesElapsed >= REGISTER_OPEN_MIN && minutesElapsed <= REGISTER_CLOSE_MIN;
  const expired            = minutesElapsed > ATTENDANCE_WINDOW_MIN;

  const minutesUntilRegister = !isCoordinator && minutesElapsed < REGISTER_OPEN_MIN
    ? REGISTER_OPEN_MIN - minutesElapsed
    : null;
  const minutesUntilExpire = !isCoordinator && minutesElapsed >= 0 && minutesElapsed <= ATTENDANCE_WINDOW_MIN
    ? ATTENDANCE_WINDOW_MIN - minutesElapsed
    : null;

  return {
    isCoordinator,
    canMarkAttendance: isCoordinator || inAttendanceWindow,
    canRegister:       isCoordinator || inRegisterWindow,
    isExpired:         !isCoordinator && expired,
    minutesElapsed,
    minutesUntilRegister,
    minutesUntilExpire,
  };
}

/** Mensaje unificado cuando expiró la ventana (mostrar al advisor). */
export const EXPIRED_MESSAGE =
  'Período de registro vencido. Para marcar asistencia y registrar la sesión, contacta al Coordinador Académico.';
