import 'server-only';
import { queryOne } from '@/lib/postgres';

/**
 * Resuelve los datos del ejecutivo comercial (asesor) que creó el contrato.
 *
 * `PEOPLE.asesor` NO siempre guarda un email: en la mayoría de los contratos
 * migrados trae el NOMBRE del comercial ("Antonella Calderón"). La versión
 * anterior asumía que siempre era un email y, al no encontrarlo en
 * USUARIOS_ROLES, devolvía `{ nombre: valor, email: valor }` — por eso el PDF
 * imprimía "Correo del ejecutivo: Antonella Calderón".
 *
 * Ahora:
 *   - Si el valor parece email → se busca por email (y se saca el nombre).
 *   - Si parece un nombre → se busca su email real en USUARIOS_ROLES por nombre.
 *   - Si no se encuentra → se devuelve el nombre y el email VACÍO. Nunca se
 *     rellena el correo con algo que no sea un correo.
 */
export interface AsesorInfo {
  nombre: string;
  email: string;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export async function getAsesorInfo(
  asesor: string | null | undefined,
  asesorMail?: string | null,
): Promise<AsesorInfo | null> {
  const raw = (asesor || '').trim();
  const mail = (asesorMail || '').trim();
  if (!raw && !mail) return null;

  // PEOPLE.asesorMail manda si está poblado y es un email válido.
  if (mail && isEmail(mail)) {
    if (!raw) return { nombre: mail, email: mail };
    if (isEmail(raw)) return await byEmail(raw, mail);
    return { nombre: raw, email: mail };
  }

  if (!raw) return null;

  if (isEmail(raw)) return await byEmail(raw, raw);

  // `asesor` es un nombre: intentar resolver su email real por nombre completo.
  try {
    const row = await queryOne<{ email: string }>(
      `SELECT "email" FROM "USUARIOS_ROLES"
        WHERE LOWER(TRIM(CONCAT_WS(' ', "nombre", "apellido"))) = LOWER(TRIM($1))
          AND "email" IS NOT NULL AND "email" <> ''
        LIMIT 1`,
      [raw],
    );
    // Sin match → nombre sí, correo vacío (no se inventa ni se repite el nombre).
    return { nombre: raw, email: row?.email || '' };
  } catch {
    return { nombre: raw, email: '' };
  }
}

/** Busca en USUARIOS_ROLES por email y arma el nombre completo. */
async function byEmail(email: string, fallbackEmail: string): Promise<AsesorInfo> {
  try {
    const row = await queryOne<{ nombre: string | null; apellido: string | null; email: string }>(
      `SELECT "nombre", "apellido", "email"
         FROM "USUARIOS_ROLES"
        WHERE LOWER(TRIM("email")) = LOWER(TRIM($1))
        LIMIT 1`,
      [email],
    );
    if (!row) return { nombre: email, email: fallbackEmail };
    const nombreCompleto = [row.nombre, row.apellido].filter(Boolean).join(' ').trim();
    return { nombre: nombreCompleto || row.email, email: row.email || fallbackEmail };
  } catch {
    return { nombre: email, email: fallbackEmail };
  }
}
