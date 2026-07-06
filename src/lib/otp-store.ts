/**
 * In-Memory OTP Store
 *
 * Temporary storage for OTP codes with automatic 10-minute expiration.
 * Suitable for single-instance deployments (Digital Ocean App Platform).
 */

import 'server-only';

interface OtpEntry {
  code: string;
  personId: string;
  celular: string;
  createdAt: number;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, OtpEntry>();

/**
 * Generate a random 6-digit OTP code.
 */
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store an OTP for a given person. Overwrites any existing OTP.
 */
export function saveOtp(personId: string, code: string, celular: string): void {
  store.set(personId, { code, personId, celular, createdAt: Date.now() });
}

/**
 * Verify an OTP code. Returns { valid, celular } on success.
 * Deletes the OTP after successful verification (one-time use).
 */
export function verifyOtp(personId: string, code: string): { valid: boolean; celular?: string } {
  const entry = store.get(personId);

  if (!entry) return { valid: false };

  // Check expiration
  if (Date.now() - entry.createdAt > OTP_TTL_MS) {
    store.delete(personId);
    return { valid: false };
  }

  // Check code match
  if (entry.code !== code) return { valid: false };

  // One-time use: delete after successful verification
  store.delete(personId);
  return { valid: true, celular: entry.celular };
}

/**
 * Peek an OTP code WITHOUT consuming it. Mismos chequeos que verifyOtp pero no borra
 * en éxito. Lo usa verify-otp (validación previa) para que el código sobreviva hasta
 * reset-password, que es quien lo consume con verifyOtp (P0-6).
 */
export function peekOtp(personId: string, code: string): { valid: boolean; celular?: string } {
  const entry = store.get(personId);
  if (!entry) return { valid: false };
  if (Date.now() - entry.createdAt > OTP_TTL_MS) {
    store.delete(personId);
    return { valid: false };
  }
  if (entry.code !== code) return { valid: false };
  return { valid: true, celular: entry.celular };
}
