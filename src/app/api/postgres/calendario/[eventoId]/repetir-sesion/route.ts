import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { UnauthorizedError, ValidationError, NotFoundError } from '@/lib/errors';
import { query, queryOne, queryMany } from '@/lib/postgres';

/**
 * GET /api/postgres/calendario/[eventoId]/repetir-sesion
 * Devuelve la info para el modal de "Repetir Lección": curso, módulo (nivel),
 * salón, las LECCIONES del módulo actual (de NIVELES) y si ya está marcado.
 */
export const GET = handlerWithAuth(async (_request, { params }, session) => {
  const email = (session?.user as any)?.email;
  if (!email) throw new UnauthorizedError('Sesión sin email');

  // Los eventos generados por campaña guardan curso/salón/campaña en CURSOS_CAMPAIGN
  // (vía cursoCampaignId), no en la fila de CALENDARIO. El "nivel" del evento es el
  // curso (ej. OKINA), no un módulo. Resolvemos todo por el enlace.
  const ev = await queryOne<any>(
    `SELECT c."_id", c."nivel", c."repetirSesion", c."repetirLeccion",
            COALESCE(cc."tipoCurso", c."curso", c."nivel") AS "curso",
            COALESCE(cc."campaign", c."campaign") AS "campaign",
            COALESCE(cc."salon", c."salon") AS "salon",
            cc."horarioCurso" AS "horario"
     FROM "CALENDARIO" c
     LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
     WHERE c."_id" = $1`,
    [params.eventoId]
  );
  if (!ev) throw new NotFoundError('Evento', params.eventoId);

  // Todas las lecciones del curso (con su módulo), para que el guía elija cuál repetir.
  const lec = await queryMany<{ code: string; step: string }>(
    `SELECT "code","step" FROM "NIVELES" WHERE "curso" = $1 ORDER BY "orden" NULLS LAST, "step"`,
    [ev.curso]
  );

  return successResponse({
    curso: ev.curso, campaign: ev.campaign, salon: ev.salon, horario: ev.horario,
    lecciones: lec.map(l => ({ value: `${l.code} - ${l.step}`, modulo: l.code, leccion: l.step })),
    yaMarcado: ev.repetirSesion === true,
    leccionMarcada: ev.repetirLeccion || null,
  });
});

/**
 * POST /api/postgres/calendario/[eventoId]/repetir-sesion
 * Botón "Repetir Lección" del guía. Marca el evento con repetirSesion=true y la
 * lección a repetir (asignada en el modal). Queda como solicitud pendiente para
 * el reporte "Solicitud Sesiones".
 *
 * Body: { leccion }  (lección del módulo actual del salón)
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  const email = (session?.user as any)?.email;
  if (!email) throw new UnauthorizedError('Sesión sin email');

  const eventoId = params.eventoId;
  const body = await request.json();
  const leccion = String(body?.leccion || '').trim();
  if (!leccion) throw new ValidationError('Debes asignar la lección a repetir.');

  const ev = await queryOne<{ _id: string }>(`SELECT "_id" FROM "CALENDARIO" WHERE "_id" = $1`, [eventoId]);
  if (!ev) throw new NotFoundError('Evento', eventoId);

  await query(
    `UPDATE "CALENDARIO" SET
       "repetirSesion" = true,
       "repetirLeccion" = $2,
       "fechaRepetirSesion" = NOW(),
       "repetirMarcadoPor" = $3,
       "autorizadoRepetir" = false,
       "_updatedDate" = NOW()
     WHERE "_id" = $1`,
    [eventoId, leccion, email]
  );

  return successResponse({ marcado: true, eventoId, leccion, message: 'Solicitud de repetir lección registrada.' });
});
