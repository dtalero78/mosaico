/**
 * GET /api/postgres/advisors/by-email/[email]
 * Get advisor details by email from ADVISORS table
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';

export const GET = handlerWithAuth(async (_req, ctx) => {
  const decodedEmail = decodeURIComponent(ctx.params.email);

  const result = await query(
    `SELECT "_id", "email", "primerNombre", "primerApellido", "nombreCompleto",
            "zoom", "activo", "fotoAdvisor", "domicilioadvisor"
     FROM "ADVISORS"
     WHERE "email" = $1`,
    [decodedEmail]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Advisor not found');
  }

  return successResponse({ advisor: result.rows[0] });
});
