import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { ESTADO_ABIERTO } from '@/services/casos-atencion.service';

/**
 * GET /api/postgres/casos-atencion?academicaId=X
 *
 * Casos del alumno (abiertos primero, luego los cerrados por fecha de cierre).
 * Lo consume la pestaña "Casos Atención" de su ficha para saber cuál mostrar:
 * un alumno puede tener varios abiertos a la vez, uno por tema (R3).
 *
 * `sinLeer` alimenta la marca de reporte no leído del listado (R7), que debe
 * verse sin entrar al caso.
 */
export const GET = handlerWithAuth(async (request) => {
  const academicaId = (new URL(request.url).searchParams.get('academicaId') || '').trim();
  if (!academicaId) throw new ValidationError('Falta academicaId.');

  const { rows } = await query<any>(
    `SELECT c."_id", c."codigo", c."tema", c."estado", c."numeroCaso", c."contrato",
            c."abiertoEn", c."cerradoEn", c."reincidenciaNivel", c."reincidenciaPatron",
            (SELECT COUNT(*)::int FROM "CASOS_REPORTES" r WHERE r."casoId" = c."_id") AS reportes,
            (SELECT COUNT(*)::int FROM "CASOS_REPORTES" r
              WHERE r."casoId" = c."_id" AND r."leido" = false) AS "sinLeer"
       FROM "CASOS_ATENCION" c
      WHERE c."academicaId" = $1
      ORDER BY (c."estado" = '${ESTADO_ABIERTO}') DESC,
               COALESCE(c."cerradoEn", c."abiertoEn") DESC`,
    [academicaId]
  );

  const abiertos = rows.filter(r => r.estado === ESTADO_ABIERTO);
  return successResponse({
    academicaId,
    casos: rows,
    total: rows.length,
    abiertos: abiertos.length,
    // El que la pestaña muestra al entrar: el abierto más reciente, o el último cerrado.
    casoInicial: (abiertos[0] || rows[0])?._id ?? null,
  });
});
