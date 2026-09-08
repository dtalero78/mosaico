import 'server-only';
import crypto from 'crypto';

/**
 * bienvenida-token.ts — llave temporal de la página de bienvenida post-firma.
 *
 * POR QUÉ EXISTE: `/bienvenida/[id]` es pública y su `id` es el mismo titularId
 * que viaja por WhatsApp en el link del contrato. Sin esto, cualquiera con ese
 * mensaje podría abrir la constancia (nombre, contrato, documento, sello) de
 * forma indefinida. El token acota el acceso a una ventana corta después de firmar.
 *
 * DISEÑO — token FIRMADO (stateless):
 *   - Se firma con NEXTAUTH_SECRET → no se puede fabricar sin el secreto.
 *   - Va atado al titularId → un token de un titular no sirve para otro.
 *   - `exp` viaja DENTRO de la firma → no se puede extender alterándolo.
 *   - Stateless: sobrevive reinicios y funciona con N réplicas.
 *
 * NO es de un solo uso a propósito: dentro de la ventana el cliente puede
 * refrescar o volver atrás sin perder su constancia. Pasada la hora, el link
 * deja de servir y la página redirige al sitio público.
 */

const TTL_MS = 60 * 60 * 1000; // 60 minutos

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET no configurado');
  return s;
}

function sign(titularId: string, exp: number): string {
  return crypto
    .createHmac('sha256', secret())
    .update(`bienvenida:${titularId.trim()}:${exp}`)
    .digest('hex');
}

/** Emite el token al quedar firmado el consentimiento. Formato: "<exp>.<hmac>". */
export function issueBienvenidaToken(titularId: string): string {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${sign(titularId, exp)}`;
}

/** Valida el token contra el titularId. Devuelve false si expiró o no coincide. */
export function verifyBienvenidaToken(titularId: string, token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const [expRaw, hmac] = token.split('.');
  if (!expRaw || !hmac) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const esperado = sign(titularId, exp);
  // Comparación en tiempo constante: evita distinguir un token casi-correcto.
  const a = Buffer.from(hmac, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
