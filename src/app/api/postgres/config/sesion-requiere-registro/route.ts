import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { isRegistroSesionRequerido } from '@/services/advisor-event-log.service';

/**
 * GET /api/postgres/config/sesion-requiere-registro
 *
 * Lee el flag APP_CONFIG.sesion_requiere_registro (default true).
 * Usado por /sesion/[id] para activar el aviso suave al salir sin cerrar.
 */
export const GET = handlerWithAuth(async () => {
  const value = await isRegistroSesionRequerido();
  return successResponse({ value });
});
