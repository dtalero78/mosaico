import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/guias
 *
 * Catálogo de guías (tabla GUIAS, propia de MOSAICO con los mismos campos que
 * ADVISORS). Alimenta el dropdown "Guía" del módulo Crea Campaña.
 * Devuelve los guías activos ordenados por nombre.
 */
export const GET = handler(async () => {
  const result = await query(
    `SELECT "_id","nombreCompleto","primerNombre","primerApellido","email","cuentaZoom"
     FROM "GUIAS"
     WHERE "activo" IS NOT FALSE
     ORDER BY "nombreCompleto" ASC NULLS LAST`
  );
  return successResponse({ guias: result.rows });
});
