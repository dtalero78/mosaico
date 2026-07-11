import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';

/**
 * PATCH /api/admin/filiales/[id]  { activo }  → activa/suprime (soft) una filial.
 * DELETE /api/admin/filiales/[id]             → borra la filial (si no está en uso).
 * Gateado por MANTENIMIENTO.USUARIOS.CREAR_ROL.
 */
export const PATCH = handlerWithAuth(async (request, ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const id = ctx.params.id;
  const body = await request.json();
  if (typeof body?.activo !== 'boolean') throw new ValidationError('activo (boolean) es requerido.');

  const res = await query(
    `UPDATE "FILIALES" SET "activo" = $2, "_updatedDate" = NOW() WHERE "_id" = $1
     RETURNING "_id","plataforma","nombre","activo"`,
    [id, body.activo]
  );
  if (res.rowCount === 0) throw new NotFoundError('Filial', id);
  return successResponse({ filial: res.rows[0] });
});

export const DELETE = handlerWithAuth(async (_request, ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const id = ctx.params.id;

  const fil = await query<{ plataforma: string; nombre: string }>(
    `SELECT "plataforma","nombre" FROM "FILIALES" WHERE "_id" = $1`, [id]
  );
  if (fil.rowCount === 0) throw new NotFoundError('Filial', id);

  // No borrar si hay comerciales usando esa filial (se puede desactivar en su lugar).
  const enUso = await query<{ n: number }>(
    `SELECT COUNT(*)::int n FROM "EQUIPO_COMERCIAL"
     WHERE LOWER("plataforma") = LOWER($1) AND LOWER("filial") = LOWER($2)`,
    [fil.rows[0].plataforma, fil.rows[0].nombre]
  );
  if ((enUso.rows[0]?.n ?? 0) > 0) {
    throw new ValidationError(`No se puede borrar: hay ${enUso.rows[0].n} comercial(es) con esta filial. Puedes desactivarla.`);
  }

  await query(`DELETE FROM "FILIALES" WHERE "_id" = $1`, [id]);
  return successResponse({ deleted: true, _id: id });
});
