import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/postgres/recaudos/asignar-masivo
 *
 * Asigna masivamente un gestor de recaudo (gestorRecaudo) a varios TITULARES.
 * Body: { ids: string[], gestorRecaudo: string }
 *
 * Validaciones (mismas que la asignación individual en PATCH people/[id]):
 *   - gestorRecaudo debe existir en USUARIOS_ROLES, activo=true, rol IN
 *     ('RECAUDOS_ASESOR','RECAUDOS_JEFE').
 *   - Solo se actualizan filas TITULAR SIN gestor previo (no reasigna): en la
 *     UI la casilla está deshabilitada para los ya asignados, y aquí se refuerza.
 *
 * Gateado por RECAUDOS.APROBACIONES.ASIGNAR.
 */
export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.APROBACIONES_ASIGNAR);

  const body = await req.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === 'string' && x) : [];
  const gestorRecaudo: string = (body?.gestorRecaudo || '').trim();

  if (ids.length === 0) throw new ValidationError('No se seleccionaron contratos');
  if (ids.length > 2000) throw new ValidationError('Máximo 2000 contratos por asignación');
  if (!gestorRecaudo) throw new ValidationError('Debe seleccionar un gestor de recaudo');

  // Validar el gestor
  const user = await queryOne<{ nombre: string | null; rol: string; activo: boolean }>(
    `SELECT "nombre", "rol", "activo" FROM "USUARIOS_ROLES" WHERE "_id" = $1`,
    [gestorRecaudo]
  );
  if (!user) throw new ValidationError('Gestor de recaudo no encontrado');
  if (!user.activo) throw new ValidationError('El gestor seleccionado no está activo');
  if (!['RECAUDOS_ASESOR', 'RECAUDOS_JEFE'].includes(user.rol)) {
    throw new ValidationError(`Rol inválido para gestor de recaudo: ${user.rol}`);
  }

  // Solo TITULARES sin gestor previo (no reasigna)
  const result = await query(
    `UPDATE "PEOPLE"
        SET "gestorRecaudo" = $1, "_updatedDate" = NOW()
      WHERE "_id" = ANY($2::text[])
        AND "tipoUsuario" = 'TITULAR'
        AND ("gestorRecaudo" IS NULL OR "gestorRecaudo" = '')`,
    [gestorRecaudo, ids]
  );

  const asignados = result.rowCount || 0;
  return successResponse({
    asignados,
    omitidos: ids.length - asignados,
    gestorNombre: user.nombre || gestorRecaudo,
  });
});
