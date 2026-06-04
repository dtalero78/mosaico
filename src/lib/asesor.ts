import 'server-only';
import { queryOne } from '@/lib/postgres';

/**
 * Resuelve los datos del ejecutivo comercial (asesor) que creó el contrato.
 * `PEOPLE.asesor` guarda el email del comercial; aquí lo enriquecemos con
 * su nombre completo desde USUARIOS_ROLES (matched por email case-insensitive).
 *
 * Si no se encuentra → devuelve solo el email como fallback (no rompe nada).
 * Si el email es null/vacío → devuelve null.
 */
export interface AsesorInfo {
  nombre: string;
  email: string;
}

export async function getAsesorInfo(email: string | null | undefined): Promise<AsesorInfo | null> {
  if (!email || !email.trim()) return null;
  try {
    const row = await queryOne<{ nombre: string | null; apellido: string | null; email: string }>(
      `SELECT "nombre", "apellido", "email"
         FROM "USUARIOS_ROLES"
        WHERE LOWER(TRIM("email")) = LOWER(TRIM($1))
        LIMIT 1`,
      [email],
    );
    if (!row) return { nombre: email, email };
    const nombreCompleto = [row.nombre, row.apellido].filter(Boolean).join(' ').trim();
    return { nombre: nombreCompleto || row.email, email: row.email };
  } catch {
    return { nombre: email, email };
  }
}
