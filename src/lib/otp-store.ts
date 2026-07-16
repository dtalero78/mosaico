/**
 * Almacén temporal de OTP y de tickets de restablecimiento (in-memory).
 *
 * Sirve a DOS flujos:
 *   - Consentimiento declarativo del contrato (consent.service, keyed por titularId).
 *   - Recuperación de contraseña (forgot-password, keyed por email).
 *
 * ⚠ In-memory: hoy la app corre con instance_count=1, así que funciona. Con más de
 * una instancia el OTP se emitiría en una y se validaría en otra (fallaría en
 * silencio); además cada deploy borra los códigos en vuelo. Si se escala, esto
 * debe mudarse a Postgres.
 */

import 'server-only';
import crypto from 'crypto';

interface OtpEntry {
  code: string;
  personId: string;
  celular: string;
  createdAt: number;
  attempts: number;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutos
/** Intentos fallidos antes de invalidar el código. Sin esto los 10^6 códigos son
 *  forzables dentro de la ventana de 10 min (antes un fallo no penalizaba nada). */
const MAX_ATTEMPTS = 3;

const store = new Map<string, OtpEntry>();

/**
 * Código OTP de 6 dígitos con generador CRIPTOGRÁFICO.
 * (Antes usaba Math.random(), predecible y no apto para un secreto.)
 */
export function generateOtp(): string {
  // randomInt es uniforme en [100000, 1000000) → siempre 6 dígitos.
  return String(crypto.randomInt(100000, 1000000));
}

/** Guarda un OTP. Sobrescribe cualquiera anterior y reinicia el contador. */
export function saveOtp(personId: string, code: string, celular: string): void {
  store.set(personId, { code, personId, celular, createdAt: Date.now(), attempts: 0 });
}

/**
 * Verifica un OTP. Devuelve { valid, celular } si acierta.
 * Se borra tras un acierto (un solo uso) y también al agotar los intentos.
 */
export function verifyOtp(
  personId: string,
  code: string
): { valid: boolean; celular?: string; reason?: 'expired' | 'attempts' | 'mismatch' | 'missing' } {
  const entry = store.get(personId);

  if (!entry) return { valid: false, reason: 'missing' };

  if (Date.now() - entry.createdAt > OTP_TTL_MS) {
    store.delete(personId);
    return { valid: false, reason: 'expired' };
  }

  // Comparación en tiempo constante: no distinguir códigos por lo que tarda.
  const a = Buffer.from(entry.code);
  const b = Buffer.from(String(code ?? ''));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      store.delete(personId); // quemado: hay que pedir un código nuevo
      return { valid: false, reason: 'attempts' };
    }
    return { valid: false, reason: 'mismatch' };
  }

  store.delete(personId); // un solo uso
  return { valid: true, celular: entry.celular };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tickets de restablecimiento
 *
 * Encadenan "verificar OTP" con "cambiar la contraseña". Antes NO existían: al
 * validar el OTP sólo se devolvía un mensaje y reset-password no comprobaba nada,
 * así que con sólo saber un correo se le cambiaba la clave a cualquiera desde
 * internet (los pasos 1-3 eran decorativos). Ahora el paso 4 exige un ticket que
 * únicamente emite el paso 3.
 * ──────────────────────────────────────────────────────────────────────────── */

interface ResetTicket {
  token: string;
  createdAt: number;
}

const RESET_TTL_MS = 10 * 60 * 1000; // 10 min para escribir la nueva clave
const resetStore = new Map<string, ResetTicket>();

/** Emite el ticket para `key` (el email). Reemplaza cualquiera anterior. */
export function issueResetToken(key: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  resetStore.set(key, { token, createdAt: Date.now() });
  return token;
}

/**
 * Valida y QUEMA el ticket (un solo uso). Devuelve false si no existe, expiró o
 * no coincide. Se quema también al fallar: un ticket no se adivina a reintentos.
 */
export function consumeResetToken(key: string, token: string): boolean {
  const t = resetStore.get(key);
  if (!t) return false;

  if (Date.now() - t.createdAt > RESET_TTL_MS) {
    resetStore.delete(key);
    return false;
  }

  const a = Buffer.from(t.token);
  const b = Buffer.from(String(token ?? ''));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  resetStore.delete(key);
  return ok;
}
