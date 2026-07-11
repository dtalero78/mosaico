import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, ConflictError } from '@/lib/errors';
import { query, queryMany } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

/**
 * GET /api/admin/filiales[?plataforma=Chile&includeInactive=1]
 * Lista las filiales (por defecto solo activas). Alimenta el dropdown del alta de
 * comercial y la tarjeta de gestión de filiales.
 *
 * POST /api/admin/filiales  { plataforma, nombre } → crea una filial.
 * Gateado por MANTENIMIENTO.USUARIOS.CREAR_ROL.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const { searchParams } = new URL(request.url);
  const plataforma = searchParams.get('plataforma');
  const includeInactive = searchParams.get('includeInactive') === '1';

  const rows = await queryMany(
    `SELECT "_id", "plataforma", "nombre", "activo", "_createdDate"
     FROM "FILIALES"
     WHERE ($1::text IS NULL OR LOWER("plataforma") = LOWER($1))
       AND ($2::boolean OR "activo" = true)
     ORDER BY "plataforma" ASC, "nombre" ASC`,
    [plataforma || null, includeInactive]
  );
  return successResponse({ filiales: rows });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const body = await request.json();
  const plataforma = String(body?.plataforma || '').trim();
  const nombre = String(body?.nombre || '').trim();
  if (!plataforma) throw new ValidationError('La plataforma es obligatoria.');
  if (!nombre) throw new ValidationError('El nombre de la filial es obligatorio.');

  try {
    const res = await query(
      `INSERT INTO "FILIALES" ("_id","plataforma","nombre","activo","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,true,NOW(),NOW())
       RETURNING "_id","plataforma","nombre","activo"`,
      [generateId('fil'), plataforma, nombre]
    );
    return successResponse({ filial: res.rows[0] });
  } catch (e: any) {
    if (e?.code === '23505') throw new ConflictError(`La filial "${nombre}" ya existe en ${plataforma}.`);
    throw e;
  }
});
