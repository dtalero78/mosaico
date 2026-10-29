import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError } from '@/lib/errors';
import { crmEsquema } from '@/lib/crm';

/** GET — diagnóstico de SOLO LECTURA del esquema del CRM (columnas de User y tablas tipo filial). SUPER_ADMIN. */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  if ((session?.user as any)?.role !== 'SUPER_ADMIN') throw new ForbiddenError('Solo SUPER_ADMIN');
  return successResponse(await crmEsquema());
});
