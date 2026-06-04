/**
 * GET /api/postgres/advisors/by-email/[email]
 * Get advisor details by email from ADVISORS table
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';

export const GET = handlerWithAuth(async (_req, ctx) => {
  const decodedEmail = decodeURIComponent(ctx.params.email);

  // Match case-insensitive + TRIM para tolerar emails con espacios al borde o
  // case mismatch entre USUARIOS_ROLES.email (sesión NextAuth) y ADVISORS.email.
  // Mismo patrón que /api/admin/users/create-from-academica.
  // Sin esta normalización, un advisor con email mal capturado puede dejar de
  // ver botón "Registrar Sesión" porque /sesion/[id] usa esta ruta para
  // resolver isMyEvent.
  const result = await query(
    `SELECT "_id", "email", "primerNombre", "primerApellido", "nombreCompleto",
            "zoom", "activo", "fotoAdvisor", "domicilioadvisor"
     FROM "ADVISORS"
     WHERE LOWER(TRIM("email")) = LOWER(TRIM($1))
     LIMIT 1`,
    [decodedEmail]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Advisor not found');
  }

  return successResponse({ advisor: result.rows[0] });
});
