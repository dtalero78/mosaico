import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/api-permissions';
import { migrarComprobantes } from '@/services/recibo-inscripcion.service';

/**
 * POST { apply?: boolean, limite?: number } — mueve los comprobantes que estaban
 * en la documentación del contrato al "Recibo de inscripción" y los lee con IA.
 * Ensayo por defecto (apply=false): devuelve el plan sin escribir nada.
 * Sólo SUPER_ADMIN/ADMIN: es una operación de mantenimiento, de una vez.
 */
export const POST = handlerWithAuth(async (req, _ctx, session) => {
  requireAdmin(session, 'migrar los comprobantes');
  const body = await req.json().catch(() => ({}));
  const r = await migrarComprobantes({
    apply: body?.apply === true,
    actor: (session?.user?.email as string) || 'migracion',
    limite: Number.isFinite(Number(body?.limite)) && Number(body.limite) > 0 ? Number(body.limite) : undefined,
  });
  return successResponse(r);
});
