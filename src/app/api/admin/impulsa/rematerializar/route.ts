import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { materializarCalendarioImpulsa } from '@/services/impulsa-calendario.service';
import { regenerarCursoPreservandoEstado } from '@/services/cursos-campaign-eventos.service';

/**
 * POST /api/admin/impulsa/rematerializar — body { cursoId }
 *
 * Reconstruye el calendario de un curso IMPULSA desde su configuración guardada
 * (`IMPULSA_CURSO_CONFIG`) y le vuelve a generar los agendamientos a sus alumnos.
 *
 * Existe porque el calendario de IMPULSA NO se puede reconstruir con el motor de
 * MOSAICO: éste lo arma desde el horario semanal y le borraría los entrenamientos
 * y las evaluaciones, dejándolo como sesiones sueltas. Si eso llega a pasar —por
 * un error o por regenerarlo desde la pantalla equivocada— la configuración sigue
 * guardada y esto lo devuelve a su forma.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const body = await request.json().catch(() => ({}));
  const cursoId = String(body?.cursoId || '').trim();
  if (!cursoId) throw new ValidationError('Falta el curso.');

  const curso = (await query<any>(
    `SELECT "_id","campaign","tipoCurso","salon","guia","numeroUsuarios","horarioCurso"
       FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoId]
  )).rows[0];
  if (!curso) throw new NotFoundError('Curso', cursoId);
  if (String(curso.tipoCurso || '').toUpperCase() !== 'IMPULSA') {
    throw new ValidationError('Este curso no es IMPULSA.');
  }

  const cfg = (await query<any>(
    `SELECT "authorTz","inicioSesiones"::text AS "inicioSesiones","finSesiones"::text AS "finSesiones",
            "festivos","entrenamientos","evaluaciones"
       FROM "IMPULSA_CURSO_CONFIG" WHERE "cursoCampaignId" = $1`, [cursoId]
  )).rows[0];
  if (!cfg) throw new NotFoundError('Configuración IMPULSA del curso', cursoId);

  // Se reusa el flujo que preserva la asistencia ya marcada (snapshot por
  // estudiante y fecha, borrado de agendamientos, regeneración y re-aplicación),
  // cambiándole SÓLO el motor de eventos por el de IMPULSA. Materializar por su
  // cuenta no sirve: borra CALENDARIO sin borrar antes los agendamientos y choca
  // con la clave foránea.
  const r = await regenerarCursoPreservandoEstado(cursoId, async (c) => {
    const { count } = await materializarCalendarioImpulsa(
      c,
      {
        authorTz: cfg.authorTz,
        inicioSesiones: String(cfg.inicioSesiones).slice(0, 10),
        finSesiones: String(cfg.finSesiones).slice(0, 10),
        festivos: cfg.festivos || [],
        entrenamientos: cfg.entrenamientos || [],
        evaluaciones: cfg.evaluaciones || [],
      },
      (session?.user as any)?.email || null,
    );
    return count;
  });

  return successResponse(r);
});
