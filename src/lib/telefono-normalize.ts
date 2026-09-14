/**
 * Normalización canónica de teléfonos (cliente Y servidor).
 *
 * Un teléfono se guarda SÓLO con dígitos: sin `+`, sin espacios, sin paréntesis
 * ni guiones. Es como ya lo espera todo lo que lo consume —`formatPhoneNumber`
 * de [whatsapp.ts](src/lib/whatsapp.ts) descarta cualquier caracter que no sea
 * dígito antes de llamar a Whapi— y como está guardada la inmensa mayoría de la
 * base. Dejar entrar un `+56 9 7981 9760` obliga a cada lector a limpiarlo por
 * su cuenta, y el que se olvide compara contra un valor que no existe.
 *
 *   normalizeTelefono('+56 9 7981 9760') → '56979819760'
 *   normalizeTelefono('(300) 123-4567')  → '3001234567'
 *   normalizeTelefono(null/undefined)    → ''
 *
 * ⚠ El `+` se QUITA, no se traduce: el indicativo queda en los dígitos que ya
 * venían detrás. Por eso el prefijo de país de los formularios (`+57`) tiene que
 * concatenarse ANTES de normalizar, no después.
 */
export function normalizeTelefono(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
}

/** Igual que `normalizeTelefono`, pero devuelve `null` cuando queda vacío. */
export function normalizeTelefonoOrNull(raw: string | null | undefined): string | null {
  const t = normalizeTelefono(raw);
  return t === '' ? null : t;
}
