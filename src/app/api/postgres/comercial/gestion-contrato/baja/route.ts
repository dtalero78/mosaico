import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { getUserComercialScope } from '@/lib/crm';
import { darDeBajaContratos } from '@/services/purga-contrato.service';

/**
 * POST /api/postgres/comercial/gestion-contrato/baja
 *
 * Da de baja (BORRA) los contratos marcados y todos sus registros: PEOPLE,
 * ACADEMICA, clases, financiero, pagos, overrides, complementarias y logins.
 *
 * ⚠ Es irreversible desde la interfaz, pero **queda el snapshot completo en
 * `PURGE_LOG`** antes de borrar, así que se puede reconstruir a mano.
 *
 * Guardas — todas server-side, no basta con que la lista no los muestre:
 *   - permiso propio `COMERCIAL.GESTION_CONTRATO.DAR_BAJA`
 *   - scope de líder: no se puede dar de baja el contrato de otro equipo
 *   - NI aprobado NI listo (`motivoNoDableDeBaja`)
 *   - motivo obligatorio y máximo 50 por operación
 */
const MAX = 50;

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO_DAR_BAJA);

  const b = await request.json().catch(() => ({}));
  const idsPedidos: string[] = Array.isArray(b?.ids) ? b.ids.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  const motivo = String(b?.motivo || '').trim();

  if (!idsPedidos.length) throw new ValidationError('No hay contratos marcados.');
  if (!motivo) throw new ValidationError('El motivo es obligatorio.');
  if (idsPedidos.length > MAX) throw new ValidationError(`Máximo ${MAX} contratos por operación.`);

  const role = (session as any)?.user?.role;
  const email = (session as any)?.user?.email || 'desconocido';
  const scope = (role === 'SUPER_ADMIN' || role === 'ADMIN')
    ? { seeAll: true, liderCorreo: null as string | null }
    : await getUserComercialScope(email);

  // Acotar al equipo ANTES de borrar nada: si alguno queda fuera del scope, se
  // descarta en silencio de la lista y se reporta al final.
  let permitidos = idsPedidos;
  if (!scope.seeAll) {
    const { rows } = await query<any>(
      `SELECT "_id" FROM "PEOPLE"
        WHERE "_id" = ANY($1::text[]) AND "tipoUsuario" = 'TITULAR'
          AND LOWER("liderComercialCorreo") = LOWER($2)`,
      [idsPedidos, scope.liderCorreo]
    );
    permitidos = rows.map(r => r._id);
  }

  const fueraDeScope = idsPedidos.filter(id => !permitidos.includes(id));
  const ipRaw = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';

  const resultados = await darDeBajaContratos(permitidos, {
    motivo,
    actorEmail: email,
    actorNombre: (session as any)?.user?.name ?? null,
    ip: ipRaw.split(',')[0].trim(),
    userAgent: request.headers.get('user-agent') || '',
  });

  for (const id of fueraDeScope) {
    resultados.push({ contrato: id, status: 'rechazado', error: 'Fuera de tu equipo comercial.' });
  }

  const ok = resultados.filter(r => r.status === 'ok');
  const fallidos = resultados.filter(r => r.status !== 'ok');
  return successResponse({
    resultados,
    okCount: ok.length,
    falloCount: fallidos.length,
    message: fallidos.length
      ? `${ok.length} contrato(s) dados de baja · ${fallidos.length} no se pudieron.`
      : `${ok.length} contrato(s) dados de baja.`,
  });
});
