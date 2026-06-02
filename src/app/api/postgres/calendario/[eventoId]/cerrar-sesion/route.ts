import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { UnauthorizedError } from '@/lib/errors';
import { closeSession } from '@/services/advisor-event-log.service';

/**
 * POST /api/postgres/calendario/[eventoId]/cerrar-sesion
 *
 * Botón "Registrar Sesión" del advisor. Marca el evento como cerrado.
 * Si notasadvisor está vacío, set automáticamente "no hubo novedades".
 * Requiere timeout previamente guardado.
 *
 * Body opcional:
 *   {
 *     sinAsistentes?: boolean   // si true: marca todos los bookings como
 *                                // no-asistido + motivoCierre='SIN_ASISTENTES'
 *   }
 *
 * Bypass de ventana temporal: COORDINADOR_ACADEMICO / SUPER_ADMIN / ADMIN.
 * El rol se toma de la sesión NextAuth — NUNCA del body (no spoofeable).
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  const email = (session?.user as any)?.email;
  if (!email) throw new UnauthorizedError('Sesión sin email');
  const sessionRole = (session?.user as any)?.role;

  // Body es opcional — solo se lee si hay payload.
  let body: { sinAsistentes?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await closeSession(params.eventoId, email, {
    sinAsistentes: body?.sinAsistentes === true,
    sessionRole,
  });
  return successResponse(result);
});
