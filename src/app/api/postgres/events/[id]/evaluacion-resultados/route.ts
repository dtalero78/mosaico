import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query, queryOne } from '@/lib/postgres';
import { deriveCuestionarios } from '@/lib/cuestionarios';

/**
 * GET /api/postgres/events/[id]/evaluacion-resultados
 *
 * Para el botón "Revisar Evaluación" del panel del evento: si la lección del
 * evento es de un módulo Evaluación, devuelve los cuestionarios de esa lección y,
 * por cada estudiante inscrito, sus intentos / mejor nota / aprobó por cuestionario.
 * Gateado por ACADEMICO.EVALUACIONES.VER.
 */
export const GET = handlerWithAuth(async (_request, ctx, session) => {
  await requirePermission(session, AcademicoPermission.EVALUACIONES_VER);
  const eventoId = (ctx?.params?.id || '').toString();

  const ev = await queryOne<{ curso: string | null; nivel: string | null; step: string | null; tituloONivel: string | null; salon: string | null }>(
    `SELECT "curso","nivel","step","tituloONivel","salon" FROM "CALENDARIO" WHERE "_id"=$1 LIMIT 1`,
    [eventoId]
  );
  if (!ev) return successResponse({ esEvaluacion: false });
  const curso = ev.curso || '';
  const modulo = ev.nivel || '';
  const leccion = ev.step || '';
  const esEvaluacion = /evaluac/i.test(modulo);
  if (!esEvaluacion) return successResponse({ esEvaluacion: false });

  // Cuestionarios de la lección (de NIVELES).
  const nivRow = await queryOne<any>(
    `SELECT "cuestionarios","preguntasManual","evaluacionModo","evaluacionMinutos"
       FROM "NIVELES" WHERE UPPER("curso")=UPPER($1) AND "code"=$2 AND "step"=$3 LIMIT 1`,
    [curso, modulo, leccion]
  );
  const cuestionarios = deriveCuestionarios(nivRow || {}).map((c) => ({ id: c.id, titulo: c.titulo }));

  // Roster: inscritos al evento (bookings no cancelados).
  const roster = (await query<{ academicaId: string; numeroId: string | null; nombre: string | null }>(
    `SELECT DISTINCT b."idEstudiante" AS "academicaId", a."numeroId",
            TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "ACADEMICA" a ON a."_id"=b."idEstudiante"
      WHERE (b."eventoId"=$1 OR b."idEvento"=$1) AND COALESCE(b."cancelo",false)=false`,
    [eventoId]
  )).rows;

  // Resultados de la lección (todos los estudiantes que presentaron).
  const res = (await query<{ academicaId: string; nombre: string | null; numeroId: string | null; cuestionarioId: string | null; intentos: number; mejor: number; aprobado: boolean }>(
    `SELECT er."academicaId", MAX(er."nombre") AS nombre, MAX(er."numeroId") AS "numeroId",
            er."cuestionarioId", COUNT(*)::int AS intentos, MAX(COALESCE(er."porcentaje",0))::int AS mejor,
            BOOL_OR(COALESCE(er."aprobado",false)) AS aprobado
       FROM "EVALUACION_RESPUESTAS" er
      WHERE UPPER(er."curso")=UPPER($1) AND er."code"=$2 AND er."step"=$3 AND er."enviadaEn" IS NOT NULL
      GROUP BY er."academicaId", er."cuestionarioId"`,
    [curso, modulo, leccion]
  )).rows;

  const primerId = cuestionarios[0]?.id || 'c1';
  // Unir roster + quienes presentaron (aunque no estén en el roster).
  const byId: Record<string, { academicaId: string; numeroId: string; nombre: string; porCuest: Record<string, any> }> = {};
  const ensure = (id: string, numeroId?: string | null, nombre?: string | null) => {
    if (!byId[id]) byId[id] = { academicaId: id, numeroId: numeroId || '', nombre: nombre || '', porCuest: {} };
    else { if (numeroId && !byId[id].numeroId) byId[id].numeroId = numeroId; if (nombre && !byId[id].nombre) byId[id].nombre = nombre; }
  };
  for (const r of roster) ensure(r.academicaId, r.numeroId, r.nombre);
  for (const r of res) {
    ensure(r.academicaId, r.numeroId, r.nombre);
    const cid = r.cuestionarioId || primerId;
    const aprobado = !!r.aprobado; const intentos = Number(r.intentos) || 0;
    byId[r.academicaId].porCuest[cid] = {
      intentos, mejor: Number(r.mejor) || 0, aprobado,
      estado: aprobado ? 'aprobado' : (intentos >= 3 ? 'no_aprobado' : 'en_curso'),
    };
  }
  const rows = Object.values(byId)
    .map((s) => {
      const estados = cuestionarios.map((c) => s.porCuest[c.id]?.estado || 'pendiente');
      const estadoGlobal = estados.every(e => e === 'aprobado') ? 'completa'
        : estados.some(e => e === 'no_aprobado') ? 'reprobo'
        : estados.some(e => e !== 'pendiente') ? 'en_curso' : 'sin_iniciar';
      return { academicaId: s.academicaId, numeroId: s.numeroId, nombre: s.nombre || '(sin nombre)', porCuest: s.porCuest, estadoGlobal };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return successResponse({
    esEvaluacion: true, curso, modulo, leccion, salon: ev.salon || '',
    label: ev.tituloONivel || `${curso} · ${modulo} · ${leccion}`,
    cuestionarios, rows,
  });
});
