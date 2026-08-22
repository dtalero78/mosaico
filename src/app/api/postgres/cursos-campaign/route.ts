import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';

/**
 * GET /api/postgres/cursos-campaign
 *
 * Catálogo activo para los dropdowns en cascada de Crear Contrato:
 *   campaña vigente → cursos → horarios.
 *
 * Devuelve filas planas activas; el frontend deriva la cascada y filtra
 * `paraMenores` cuando el titular es el beneficiario (solo adultos).
 */
export const GET = handler(async () => {
  const result = await query(
    `SELECT "campaign", "tipoCurso", "horarioCurso", "paraMenores", "salon", "guia",
            "inicioCurso", "finalCurso", "finalCampaign",
            -- Inicio de la CAMPAÑA = su primer curso. Los demás sólo se reúnen
            -- otro día de la semana (LUN-MIÉ, MAR-JUE, SÁB); la semana de
            -- matrícula se cuenta desde el primero.
            MIN("inicioCurso"::text) OVER (PARTITION BY "campaign") AS "inicioCampanaCursos",
            COALESCE("numeroUsuarios", 0) AS "numeroUsuarios",
            -- cupos = beneficiarios cuyo contrato NO está rechazado/retractado/nulo (ver lib/cupo)
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
               WHERE pe."tipoUsuario"='BENEFICIARIO'
                 AND pe."campaign" = "CURSOS_CAMPAIGN"."campaign"
                 AND pe."tipoCurso" = "CURSOS_CAMPAIGN"."tipoCurso"
                 AND pe."horarioCurso" = "CURSOS_CAMPAIGN"."horarioCurso"
                 AND ${cupoOcupadoSql('pe')}) AS "usuInscritos"
     FROM "CURSOS_CAMPAIGN"
     WHERE "activa" = true
     ORDER BY "campaign",
       CASE "tipoCurso" WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
                        WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END,
       "salon", "horarioCurso"`
  );
  return successResponse({ rows: result.rows });
});
