import 'server-only';
import bcrypt from 'bcryptjs';

/**
 * Utilidades de contraseña (SEC-PLAINTEXT-PW-09).
 *
 * El login (auth-postgres / auth.ts legacy) ya valida tanto hashes bcrypt como
 * texto plano, así que hashear en los puntos de escritura es compatible hacia atrás:
 * las contraseñas viejas en texto plano siguen validando; las nuevas quedan cifradas.
 */
const BCRYPT_ROUNDS = 10;

/** ¿El valor ya es un hash bcrypt ($2a/$2b/$2y)? */
export function isHashed(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\$2[aby]\$/.test(value);
}

/** Hashea una contraseña en texto plano. Si ya viene hasheada, la devuelve tal cual (idempotente). */
export async function hashPassword(plain: string): Promise<string> {
  if (isHashed(plain)) return plain;
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
