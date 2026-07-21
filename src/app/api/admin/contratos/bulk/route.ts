import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { validateBulk, createBulk } from '@/services/contratos-bulk.service';

/**
 * POST /api/admin/contratos/bulk
 * Body: { csvText, campaign, apply?, vigencia?, plataforma?, plan? }
 *
 * Migración de contratos por lote (Subir Lote → modo Contratos). Sin `apply`
 * (o false) → dry-run (valida, no escribe). Con `apply:true` → crea los contratos
 * sin errores bloqueantes vía `createFullContract`. Gateado por COMERCIAL.SUBIR_LOTE
 * (SUPER_ADMIN/ADMIN bypass), igual que la importación de personas.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.SUBIR_LOTE);

  const body = await request.json();
  const csvText = String(body?.csvText || '');
  if (!csvText.trim()) throw new ValidationError('csvText es requerido');

  const campaign = body?.campaign ? String(body.campaign).trim() : null;
  if (!campaign) throw new ValidationError('Selecciona una campaña destino');

  const opts = {
    campaignForzada: campaign,
    vigencia: body?.vigencia ? String(body.vigencia) : '12',
    plataforma: body?.plataforma ? String(body.plataforma) : 'Chile',
    planForzado: body?.plan ? String(body.plan) : null,
  };

  if (body?.apply === true) {
    const resumen = await createBulk(csvText, opts, session?.user?.email || undefined);
    return successResponse(resumen);
  }

  const resumen = await validateBulk(csvText, opts);
  return successResponse(resumen);
});
