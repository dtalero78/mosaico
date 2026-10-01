import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { cargarTitular, guardarRevision } from '@/services/recibo-inscripcion.service';

/**
 * POST { medioPago, fecha, monto, referencia, banco } — Recaudos confirma o
 * corrige lo leído del recibo. Queda a su nombre, se copia a FINANCIEROS y se
 * precarga la cuota de inscripción (fecha, referencia, medio) SIN validarla.
 */
export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, PersonPermission.LEER_RECIBO);
  const body = await req.json().catch(() => ({}));
  const titular = await cargarTitular(params.id);
  const r = await guardarRevision(
    titular._id,
    {
      medioPago: body?.medioPago ?? null,
      fecha: body?.fecha ?? null,
      monto: body?.monto ?? null,
      referencia: body?.referencia ?? null,
      banco: body?.banco ?? null,
    },
    (session?.user?.email as string) || 'desconocido'
  );
  return successResponse(r);
});
