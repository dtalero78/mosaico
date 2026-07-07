/**
 * GET /api/postgres/guias/by-email/[email]
 * MOSAICO: obtiene el guía por email desde la tabla GUIAS.
 *
 * Usa AdvisorRepository.findByEmail (→ GUIAS) en vez de una query cruda a
 * "ADVISORS": esa tabla NO existe en mosaico-db, y consultarla directamente
 * lanzaba un 500 (rompía el Panel Guía y el resolver isMyEvent de /sesion/[id]).
 * El repo ya normaliza case-insensitive + TRIM.
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { AdvisorRepository } from '@/repositories/advisor.repository';

export const GET = handlerWithAuth(async (_req, ctx) => {
  const decodedEmail = decodeURIComponent(ctx.params.email);

  const advisor = await AdvisorRepository.findByEmail(decodedEmail);

  if (!advisor) {
    throw new NotFoundError('Guía no encontrado');
  }

  return successResponse({ advisor });
});
