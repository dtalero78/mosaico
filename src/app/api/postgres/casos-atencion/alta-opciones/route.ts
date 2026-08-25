import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { query } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';
import { ServicioPermission } from '@/types/permissions';

/**
 * Opciones en cascada para adicionar un Caso de Atención desde Servicio:
 * **Guía → Curso → Salón → Usuario**.
 *
 * Va en un endpoint propio y no encadenando los que ya existen porque
 * `cursos-asignados` no devuelve el `_id` del curso (así que no se puede saltar
 * al roster) y el listado de inscritos está gateado por un permiso de Académico
 * que Servicio no tiene. Aquí todo se resuelve con el permiso del botón.
 *
 * Que el usuario salga del salón DEL GUÍA no es un detalle de comodidad: es lo
 * que impide firmar un reporte a nombre de alguien que no da esa clase.
 *
 * GET sin parámetros              → guías CON cursos activos
 * GET ?guiaId=                    → sus cursos (tipoCurso)
 * GET ?guiaId=&curso=             → sus salones de ese curso
 * GET ?guiaId=&curso=&salon=…     → los usuarios de ese salón
 *
 * ⚠ El salón se identifica por **(campaña, curso, horario)**, no por su número:
 * el mismo "02" existe en varias campañas. Por eso las opciones de salón viajan
 * con su campaña y horario, y el paso de usuarios los exige.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_GESTION as any);

  const sp = new URL(request.url).searchParams;
  const guiaId = (sp.get('guiaId') || '').trim();
  const curso = (sp.get('curso') || '').trim();
  const salon = (sp.get('salon') || '').trim();
  const campaign = (sp.get('campaign') || '').trim();
  const horario = (sp.get('horarioCurso') || '').trim();

  // 1) Guías que tienen al menos un curso activo: ofrecer uno sin cursos deja el
  //    siguiente paso vacío sin explicar por qué.
  if (!guiaId) {
    const { rows } = await query(
      `SELECT g."_id", g."nombreCompleto"
         FROM "GUIAS" g
        WHERE g."activo" = true
          AND EXISTS (SELECT 1 FROM "CURSOS_CAMPAIGN" cc
                       WHERE cc."guia" = g."_id" AND cc."activa" = true)
        ORDER BY UPPER(g."nombreCompleto")`
    );
    return successResponse({ guias: rows });
  }

  // 2) Cursos del guía.
  if (!curso) {
    const { rows } = await query(
      `SELECT DISTINCT "tipoCurso" AS curso
         FROM "CURSOS_CAMPAIGN" WHERE "guia" = $1 AND "activa" = true
        ORDER BY 1`,
      [guiaId]
    );
    return successResponse({ cursos: rows.map((r: any) => r.curso) });
  }

  // 3) Salones de ese curso, cada uno con la campaña y el horario que lo
  //    identifican de verdad.
  if (!salon) {
    const { rows } = await query(
      `SELECT "salon", "campaign", "horarioCurso"
         FROM "CURSOS_CAMPAIGN"
        WHERE "guia" = $1 AND "tipoCurso" = $2 AND "activa" = true
        ORDER BY "salon", "campaign"`,
      [guiaId, curso]
    );
    return successResponse({ salones: rows });
  }

  // 4) Usuarios del salón. Sólo los que ocupan cupo (ver lib/cupo): un contrato
  //    retractado ya no es alumno de ese salón.
  const cond = [`p."tipoUsuario" = 'BENEFICIARIO'`, `p."tipoCurso" = $2`, `p."salon" = $3`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`, cupoOcupadoSql('p')];
  const params: any[] = [guiaId, curso, salon];
  if (campaign) { cond.push(`p."campaign" = $${params.length + 1}`); params.push(campaign); }
  if (horario) { cond.push(`p."horarioCurso" = $${params.length + 1}`); params.push(horario); }

  const { rows } = await query(
    `SELECT a."_id" AS "academicaId", p."numeroId", p."contrato",
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre",
                 p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre
       FROM "PEOPLE" p
       -- Sin registro académico no hay caso que crear: el caso cuelga de ACADEMICA.
       JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId" AND a."tipoUsuario" = 'BENEFICIARIO'
       -- El guía se comprueba contra el curso, no se confía en el que llegó.
       WHERE EXISTS (SELECT 1 FROM "CURSOS_CAMPAIGN" cc
                      WHERE cc."guia" = $1 AND cc."activa" = true
                        AND cc."tipoCurso" = p."tipoCurso"
                        AND cc."horarioCurso" = p."horarioCurso"
                        AND cc."campaign" = p."campaign")
         AND ${cond.join(' AND ')}
       ORDER BY UPPER(p."primerApellido"), UPPER(p."primerNombre")`,
    params
  );
  return successResponse({ alumnos: rows });
});
