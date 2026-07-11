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

  const ev = await queryOne<any>(
    `SELECT "_id","curso","nivel","step","salon","repetirSesion","repetirLeccion" FROM "CALENDARIO" WHERE "_id" = $1`,
    [params.eventoId]
  );
  if (!ev) throw new NotFoundError('Evento', params.eventoId);

  // Lecciones del módulo actual (curso + code=nivel).
  const lec = await queryMany<{ step: string }>(
    `SELECT "step" FROM "NIVELES" WHERE "curso" = $1 AND "code" = $2 ORDER BY "orden" NULLS LAST, "step"`,
    [ev.curso, ev.nivel]
  );

  return successResponse({
    curso: ev.curso, modulo: ev.nivel, salon: ev.salon, stepActual: ev.step,
    lecciones: lec.map(l => l.step),
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
