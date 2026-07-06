import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/guias/[id]/cursos-asignados
 *
 * Cursos de CURSOS_CAMPAIGN asignados a un guía ([id] = GUIAS._id, columna `guia`).
 * Devuelve las filas activas (activa=true) con fechas y cupos; el estado
 * (En matrícula / Activo / Cerrado) y los filtros se resuelven en el cliente con
 * la MISMA regla que Consulta Cursos (por fecha). Solo lectura.
 */
export const GET = handlerWithAuth(async (_req, { params }) => {
  const result = await query(
    `SELECT "campaign", "tipoCurso", "horarioCurso", "salon",
            "inicioCurso"::text  AS "inicioCurso",
            "finalCurso"::text   AS "finalCurso",
            "finalCampaign"::text AS "finalCampaign",
            COALESCE("numeroUsuarios", 0) AS "numeroUsuarios",
            COALESCE("usuInscritos", 0)   AS "usuInscritos"
     FROM "CURSOS_CAMPAIGN"
     WHERE "guia" = $1 AND "activa" = true
     ORDER BY "campaign",
       CASE "tipoCurso" WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
                        WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END,
       "salon", "horarioCurso"`,
    [params.id]
  );
  return successResponse({ rows: result.rows });
});
