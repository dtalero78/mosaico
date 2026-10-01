import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission } from '@/lib/api-permissions';
import { ComercialPermission, PersonPermission } from '@/types/permissions';
import { cargarTitular, procesarLectura } from '@/services/recibo-inscripcion.service';

/**
 * POST — vuelve a leer con IA el recibo vigente (p. ej. si la lectura falló, o
 * Recaudos quiere releerlo antes de corregir). No cambia el archivo.
 */
export const POST = handlerWithAuth(async (_req, { params }, session) => {
  await requireAnyPermission(session, [
    ComercialPermission.SUBIR_RECIBO_INSCRIPCION,
    PersonPermission.LEER_RECIBO,
  ]);
  const titular = await cargarTitular(params.id);
  const r = await procesarLectura(titular._id, (session?.user?.email as string) || 'desconocido');
  return successResponse(r);
});
