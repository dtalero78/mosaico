import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';

/**
 * POST /api/postgres/reports/academico/solicitud-sesiones/autorizar
 *   { eventoIds: string[] }
 * Autoriza una o varias solicitudes de "Repetir Lección": marca autorizadoRepetir=true
 * (las saca del listado de pendientes) + registra quién/cuándo.
 * Gateado por ACADEMICO.SOLICITUD_SESIONES.GESTION.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SOLICITUD_SESIONES_GESTION);
  const email = (session?.user as any)?.email || 'desconocido';
  const body = await request.json();
  const eventoIds: string[] = Array.isArray(body?.eventoIds) ? body.eventoIds.filter((x: any) => typeof x === 'string') : [];
  if (!eventoIds.length) throw new ValidationError('Selecciona al menos una solicitud.');

  const res = await query(
    `UPDATE "CALENDARIO" SET
       "autorizadoRepetir" = true,
       "fechaAutorizadoRepetir" = NOW(),
       "autorizadoRepetirPor" = $2,
       "_updatedDate" = NOW()
     WHERE "_id" = ANY($1::text[]) AND "repetirSesion" = true`,
    [eventoIds, email]
  );

  return successResponse({ autorizadas: res.rowCount ?? 0 });
});
