/**
 * GET /api/postgres/recaudos/filiales → filiales distintas de los titulares
 * (para el filtro de Recaudos › Gestión).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryMany } from '@/lib/postgres';

export const GET = handlerWithAuth(async () => {
  const rows = await queryMany<{ filial: string }>(
    `SELECT DISTINCT TRIM("filial") AS "filial" FROM "PEOPLE"
      WHERE "tipoUsuario" = 'TITULAR' AND COALESCE(TRIM("filial"), '') <> ''
      ORDER BY 1`,
  );
  return successResponse({ filiales: rows.map(r => r.filial) });
});
