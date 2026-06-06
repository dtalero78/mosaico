/**
 * Reglas y helpers para eventos compartidos entre niveles.
 *
 * Un evento compartido es un evento del advisor (1 hora real) que se
 * replica en 2-3 filas distintas (una por nivel) para que estudiantes
 * de varios niveles puedan agendarlo. Todas las filas comparten un
 * `eventoCompartidoId` (UUID).
 *
 * REGLAS DE COMPARTIBILIDAD:
 *   - SESSION step múltiplo de 5 (Jumps: 5, 10, 15, 20, 25, 30, 35, 40, 45)
 *   - SESSION Step 46 (MASTER)
 *   - CLUB todos los tipos EXCEPTO TRAINING
 *   - Cualquier otro tipo / step → NO compartible
 *
 * Helpers sin `server-only` para reutilizar en frontend y backend.
 */

/** Máximo de filas que puede tener un grupo compartido (1 base + 2 extras). */
export const MAX_NIVELES_COMPARTIDOS = 3;

/** Prefijos de clubs que NO se pueden compartir (TRAINING es por step específico). */
const CLUB_NO_COMPARTIBLE_PREFIXES = ['TRAINING'];

/** Extrae el número del step ("Step 5" → 5; "TRAINING - Step 10" → 10). */
export function extractStepNumber(step: string | null | undefined): number | null {
  if (!step) return null;
  const m = String(step).match(/Step\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/**
 * ¿El evento con esta combinación de tipo + step es compartible entre niveles?
 *
 * @param tipo  CALENDARIO.tipo (SESSION / CLUB / WELCOME)
 * @param step  CALENDARIO.step ("Step 5", "TRAINING - Step 7", "LISTENING - Step 3", etc.)
 */
export function isEventoCompartible(tipo: string | null | undefined, step: string | null | undefined): boolean {
  const t = (tipo || '').toUpperCase();

  if (t === 'SESSION') {
    // Jumps (múltiplos de 5, hasta 45) o MASTER (46).
    const n = extractStepNumber(step);
    if (n == null) return false;
    if (n === 46) return true;
    if (n >= 5 && n <= 45 && n % 5 === 0) return true;
    return false;
  }

  if (t === 'CLUB') {
    // Todos los tipos de club excepto TRAINING.
    const prefix = String(step || '').trim().toUpperCase().split('-')[0].trim();
    return !CLUB_NO_COMPARTIBLE_PREFIXES.includes(prefix);
  }

  // WELCOME y otros: no compartibles.
  return false;
}

/**
 * Extrae el prefijo del tipo de club de un step ("KARAOKE - Step 16" → "KARAOKE",
 * "LISTENING - Step 7" → "LISTENING"). Para SESSION o steps sin prefijo
 * devuelve null.
 *
 * Sirve para validar que todos los hermanos de un grupo compartido CLUB sean
 * el MISMO tipo (no mezclar KARAOKE con LISTENING).
 */
export function extractClubPrefix(step: string | null | undefined): string | null {
  if (!step) return null;
  const s = String(step).trim();
  const m = s.match(/^([A-ZÁÉÍÓÚÑ]+)\s*-/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  // Si el "prefijo" es la palabra Step, no es realmente un prefijo de club.
  if (prefix === 'STEP') return null;
  return prefix;
}

/**
 * Mensaje human-readable de POR QUÉ el evento NO es compartible.
 * Útil para tooltip en el wizard.
 */
export function reasonNotCompartible(tipo: string | null | undefined, step: string | null | undefined): string | null {
  if (isEventoCompartible(tipo, step)) return null;
  const t = (tipo || '').toUpperCase();
  if (t === 'WELCOME') return 'Los eventos WELCOME no se comparten entre niveles.';
  if (t === 'SESSION') {
    const n = extractStepNumber(step);
    if (n != null && n >= 1 && n <= 44 && n % 5 !== 0) {
      return `Las sesiones de Step ${n} (regulares) no se comparten — solo Jumps (múltiplos de 5) y MASTER (Step 46).`;
    }
    return 'Solo las sesiones Jump (Steps 5, 10, ..., 45) y MASTER (Step 46) se pueden compartir.';
  }
  if (t === 'CLUB') {
    const prefix = String(step || '').trim().toUpperCase().split('-')[0].trim();
    if (prefix === 'TRAINING') return 'Los clubs TRAINING son por step específico y no se comparten entre niveles.';
    return 'Este club no se puede compartir.';
  }
  return 'Tipo no compartible.';
}
