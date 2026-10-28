import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError } from '@/lib/errors';
import { crmDiagnostico } from '@/lib/crm';

/**
 * GET /api/admin/crm-rangos?email=a@b.cl&email=c@d.cl
 * Diagnóstico de SOLO LECTURA de la escalera del CRM: cuántos usuarios activos hay por
 * rango (`User.position`) y, por cada correo pedido, la cadena hacia arriba por
 * `supervisorId`. Sirve para contrastar el mapeo de rangos del Libro de Producción.
 * Sólo SUPER_ADMIN.
 */
export const GET = handlerWithAuth(async (req, _ctx, session) => {
  if ((session?.user as any)?.role !== 'SUPER_ADMIN') throw new ForbiddenError('Solo SUPER_ADMIN');
  const emails = new URL(req.url).searchParams.getAll('email').slice(0, 10);
  return successResponse(await crmDiagnostico(emails));
});
