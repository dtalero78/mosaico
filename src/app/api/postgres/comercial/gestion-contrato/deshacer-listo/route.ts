import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { getUserComercialScope } from '@/lib/crm';
import { deshacerListo } from '@/services/gestion-cupo.service';

/**
 * POST /api/postgres/comercial/gestion-contrato/deshacer-listo
 *
 * Revierte el «listo» de un contrato: suelta los asientos que tomó en el salón
 * y lo devuelve a la bandeja de gestión. El alumno CONSERVA su curso — sólo deja
 * de tener el cupo reservado, igual que antes de marcarlo listo.
 *
 * Existe porque marcar listo NO tenía reversión: un clic de más dejaba el
 * asiento tomado y la única salida era ir beneficiario por beneficiario al botón
 * "Liberar cupo" de su ficha, que además le borra el curso y sus clases.
 *
 * Guardas, todas server-side:
 *   - el MISMO permiso que marcar listo (`COMERCIAL.GESTION_CONTRATO`): quien
 *     puede tomar el asiento puede soltarlo; pedir uno nuevo dejaría a quien
 *     marca sin poder corregirse.
 *   - scope de líder: no se toca el contrato de otro equipo.
 *   - el servicio rechaza si no está listo, o si el contrato ya está APROBADO
 *     (ahí los alumnos ya ocupan el salón con clases agendadas).
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);

  const b = await request.json().catch(() => ({}));
  const id = String(b?.id || '').trim();
  if (!id) throw new ValidationError('Falta el titular.');

  const role = (session as any)?.user?.role;
  const email = (session as any)?.user?.email || 'desconocido';
  const scope = (role === 'SUPER_ADMIN' || role === 'ADMIN')
    ? { seeAll: true, liderCorreo: null as string | null }
    : await getUserComercialScope(email);

  // El equipo se verifica ANTES de soltar ningún asiento.
  const params: any[] = [id];
  let scopeSql = '';
  if (!scope.seeAll) {
    params.push(scope.liderCorreo);
    scopeSql = ` AND LOWER("liderComercialCorreo") = LOWER($${params.length})`;
  }
  const dueño = await query(
    `SELECT "_id" FROM "PEOPLE" WHERE "_id"=$1 AND "tipoUsuario"='TITULAR'${scopeSql}`, params
  );
  if (!dueño.rowCount) throw new ValidationError('No se encontró el titular (o está fuera de tu equipo).');

  const motivo = String(b?.motivo || '').trim() || null;
  const r = await deshacerListo({ titularId: id, actor: email, motivo });

  return successResponse({
    ...r,
    message: r.asientosSoltados
      ? `Listo revertido · ${r.asientosSoltados} asiento(s) soltado(s) en el salón.`
      : 'Listo revertido. No había asientos tomados.',
  });
});
