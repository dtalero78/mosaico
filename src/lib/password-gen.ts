import 'server-only';
import { randomBytes } from 'crypto';

/**
 * Genera una clave legible (sin caracteres ambiguos como 0/O, 1/l/I) de `len`
 * caracteres. Usada al crear cuentas de staff/comercial con clave automática.
 */
export function generarClave(len = 10): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}
