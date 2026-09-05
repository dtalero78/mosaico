/**
 * API: /api/postgres/pagos-titulares/[id]/documentos  (POST)
 *
 * Adjunta documentos a un pago YA registrado (incluso validado). Solo agrega
 * evidencia de soporte al array documentosAdjuntos — no modifica datos
 * financieros, por eso no aplica el bloqueo de "pago validado".
 *
 * Body: { documentos: [{ url, nombre?, tipo?, fechaSubida? }] }
 * Gated por PERSON.FINANCIERA.PAGOS_REGISTRAR.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  const body = await req.json();
  const pago = await pagosTitularesService.addDocumentos(ctx.params.id, body?.documentos);
  return successResponse({ pago });
});

// DELETE { url } → quita un documento adjunto del pago (en caso de error).
export const DELETE = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  const body = await req.json();
  const pago = await pagosTitularesService.removeDocumento(ctx.params.id, body?.url);
  return successResponse({ pago });
});
