/**
 * Motor académico: las reglas que deciden si un alumno avanza.
 *
 * Estaban escritas por separado en seis servicios y dos componentes. No es sólo
 * mantenimiento: al reunirlas aparecieron dos que YA HABÍAN DIVERGIDO —ver las
 * notas de `isExitosa` e `isJumpStep`—, y una regla del avance que se aplica
 * distinto según por dónde entre el alumno es un fallo silencioso, del tipo que
 * dejó estudiantes «pegados» en un step anterior al real.
 *
 * Módulo de cliente + servidor (sin `server-only`): lo usan servicios y también
 * el modal del calendario y el panel de la sesión, y así se puede cubrir con
 * tests sin base de datos (`npm run test:unit`).
 *
 * Los nombres son los que ya tenían las copias, a propósito: así ningún sitio de
 * llamada cambia y el reemplazo se reduce a borrar la definición local y añadir
 * el import.
 */

/** Estado de un agendamiento, en lo que importa para el avance. */
export interface ClaseParaAvance {
  tipo?: string | null;
  step?: string | null;
  asistio?: boolean | null;
  asistencia?: boolean | null;
  participacion?: boolean | null;
  noAprobo?: boolean | null;
  cancelo?: boolean | null;
}

/**
 * Número del step a partir de su nombre. Tolera el prefijo del club:
 * `"Step 7"`, `"TRAINING - Step 7"` y `"Step7"` dan 7.
 *
 * El espacio es opcional (`\s*`) porque así lo hacen cinco de las seis copias;
 * la del modal del calendario exigía al menos uno y por eso `"Step7"` le daba
 * null. Se unifica en la versión permisiva.
 */
export function extractStepNumber(stepName: string | null | undefined): number | null {
  if (!stepName) return null;
  const m = String(stepName).match(/Step\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * ¿Es un Jump? Los múltiplos de 5: 5, 10, 15 … 45.
 *
 * ⚠ La regla es aritmética (`n % 5 === 0`), así que **Step 50 también cuenta**,
 * y Step 50 es DONE, no un jump. Se conserva tal cual porque es lo que hacen los
 * servicios hoy y este módulo no cambia comportamiento; el panel de la sesión
 * tenía en cambio la lista literal `[5..45]`. Acotar el rango es una decisión
 * aparte — en MOSAICO no se toca nada, porque sus eventos se llaman «Leccion NN»
 * y nunca entran aquí.
 */
export function isJumpStep(stepName: string | null | undefined): boolean {
  const n = extractStepNumber(stepName);
  return n !== null && n > 0 && n % 5 === 0;
}

/**
 * ¿La clase cuenta como cursada?
 *
 * Sólo la asistencia. **La participación NO cuenta** para un step normal: es una
 * marca aparte que sólo pesa en los Jumps (ver `aproboElJump`). La regla se fijó
 * así en `135882f`, pero la copia de las actividades complementarias se quedó con
 * la versión vieja —incluía `participacion === true`— y quedó decidiendo la
 * elegibilidad con un criterio distinto al del diagnóstico «¿Cómo voy?». Al
 * unificar se adopta la regla canónica.
 */
export function isExitosa(c: ClaseParaAvance): boolean {
  return c.asistio === true || c.asistencia === true;
}

/**
 * Regla estricta de aprobación de un Jump: hace falta que UN MISMO agendamiento
 * cumpla las cuatro condiciones a la vez.
 *
 * Se evalúa con `.some()` sobre los intentos, no con `.every()`: un intento
 * reprobado antes NO bloquea uno posterior que sí apruebe.
 */
export function aproboElJump(c: ClaseParaAvance): boolean {
  return isExitosa(c)
      && c.participacion === true
      && c.noAprobo !== true
      && c.cancelo !== true;
}

/**
 * Tipo de clase a efectos del avance.
 *
 * Una COMPLEMENTARIA cuenta como SESSION: sustituye a una sesión que falta. Si
 * el booking no trae `tipo` —los migrados de Wix— se deduce del nombre del step,
 * que es lo único que quedó.
 */
export function getClassType(c: ClaseParaAvance): 'SESSION' | 'CLUB' | 'OTHER' {
  if (c.tipo === 'SESSION' || c.tipo === 'COMPLEMENTARIA') return 'SESSION';
  if (c.tipo === 'CLUB') return 'CLUB';
  if (!c.tipo && c.step) {
    if (esTrainingClub(c.step)) return 'CLUB';
    if (/^Step\s+\d+$/i.test(c.step)) return 'SESSION';
  }
  return 'OTHER';
}

/**
 * ¿Es el club TRAINING del step? Sólo ése cuenta para completar un step normal:
 * PRONUNCIATION, GRAMMAR, LISTENING y los demás no.
 */
export function esTrainingClub(stepName: string | null | undefined): boolean {
  return /^TRAINING\s*-/i.test(String(stepName ?? ''));
}
