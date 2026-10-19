import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { withTransaction } from '@/lib/postgres';

/**
 * POST /api/postgres/guias/[id]/estado { activo: boolean }
 *
 * Activa o desactiva al guía. Gateado por ACADEMICO.GUIA.ACTIVAR.
 *
 *  - GUIAS.activo: desactivado sale de las listas y selectores de guías.
 *  - El ACCESO (USUARIOS_ROLES.activo) se cambia SÓLO si la cuenta es de rol GUIA:
 *    una persona de Coordinación que además figura como guía no debe quedar sin
 *    entrar por esto.
 *  - Sus cursos y clases NO se tocan: reasignarlos es una decisión aparte (el
 *    detalle del guía avisa cuántos tiene antes de confirmar).
 */
export const POST = handlerWithAuth(async (request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.GUIA_ACTIVAR);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');
  const body = await request.json().catch(() => ({}));
  if (typeof body?.activo !== 'boolean') throw new ValidationError('Falta indicar si se activa o se desactiva.');
  const activo: boolean = body.activo;

  const r = await withTransaction(async (client) => {
    const g = await client.query(
      `UPDATE "GUIAS" SET "activo" = $2, "_updatedDate" = NOW() WHERE "_id" = $1
       RETURNING "_id", "usuarioRolId", "nombreCompleto"`, [id, activo]
    );
    if (!g.rowCount) throw new NotFoundError('Guía', id);
    const { usuarioRolId, nombreCompleto } = g.rows[0];
    let acceso: 'cambiado' | 'otro_rol' | 'sin_cuenta' = 'sin_cuenta';
    if (usuarioRolId) {
      const u = await client.query(
        `UPDATE "USUARIOS_ROLES" SET "activo" = $2, "_updatedDate" = NOW()
          WHERE "_id" = $1 AND "rol" = 'GUIA' RETURNING "_id"`, [usuarioRolId, activo]
      );
      acceso = u.rowCount ? 'cambiado' : 'otro_rol';
    }
    return { nombreCompleto, acceso };
  });

  return successResponse({ activo, ...r });
});
