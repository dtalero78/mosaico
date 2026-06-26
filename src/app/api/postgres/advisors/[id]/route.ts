import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';

/**
 * GET   /api/postgres/advisors/[id]  → datos editables del guía (GUIAS + numberid de USUARIOS_ROLES).
 * PATCH /api/postgres/advisors/[id]  → actualiza el guía (GUIAS) y sincroniza USUARIOS_ROLES
 *                                      (email/nombre/apellido/numberid/password).
 * MOSAICO: opera sobre la tabla GUIAS (ADVISORS no existe en mosaico-db).
 */

export const GET = handlerWithAuth(async (_request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.LISTA_ADVISORS_VER);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');
  // La clave (texto plano legacy) solo se devuelve a quien puede EDITAR (GUIA_EDITAR);
  // los de solo-lectura (LISTA_VER) no la reciben.
  let canSeePassword = false;
  try { await requirePermission(session, AcademicoPermission.GUIA_EDITAR); canSeePassword = true; } catch { /* solo lectura */ }
  const row = await queryOne<Record<string, any>>(
    `SELECT g."_id", g."primerNombre", g."primerApellido", g."nombreCompleto", g."email",
            g."telefono", g."pais", g."domicilioadvisor" AS "domicilio", g."zoom",
            g."fechaNacimiento"::text AS "fechaNacimiento", g."fotoAdvisor",
            g."usuarioRolId", u."numberid" AS "numeroId",
            COALESCE(u."password", g."clave") AS "clave"
       FROM "GUIAS" g
       LEFT JOIN "USUARIOS_ROLES" u ON u."_id" = g."usuarioRolId"
      WHERE g."_id" = $1`,
    [id]
  );
  if (!row) throw new NotFoundError('Guía no encontrado');
  if (!canSeePassword) row.clave = null; // ocultar a solo-lectura
  return successResponse({ guia: row });
});

export const PATCH = handlerWithAuth(async (request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.GUIA_EDITAR);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');

  const cur = await queryOne<{ _id: string; usuarioRolId: string | null; email: string }>(
    `SELECT "_id","usuarioRolId","email" FROM "GUIAS" WHERE "_id" = $1`,
    [id]
  );
  if (!cur) throw new NotFoundError('Guía no encontrado');

  const body = await request.json();
  const primerNombre = String(body.primerNombre || '').trim();
  const primerApellido = String(body.primerApellido || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!primerNombre) throw new ValidationError('primerNombre es requerido');
  if (!primerApellido) throw new ValidationError('primerApellido es requerido');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('email no válido');

  const telefono = body.telefono != null ? String(body.telefono).trim() || null : null;
  const pais = body.pais != null ? String(body.pais).trim() || null : null;
  const domicilio = body.domicilio != null ? String(body.domicilio).trim() || null : null;
  const zoom = body.zoom != null ? String(body.zoom).trim() || null : null;
  const fechaNacimiento = /^\d{4}-\d{2}-\d{2}$/.test(body.fechaNacimiento || '') ? body.fechaNacimiento : null;
  const fotoKey = body.fotoKey ? String(body.fotoKey).trim() : null; // solo si se subió nueva
  const clave = body.clave ? String(body.clave).trim() : null;       // solo si se cambia
  const numeroId = body.numeroId != null ? (String(body.numeroId).trim().toUpperCase() || null) : null;
  const nombreCompleto = `${primerNombre} ${primerApellido}`.trim();

  // Email único (si cambió) — en GUIAS y USUARIOS_ROLES, excluyendo a este guía/su cuenta.
  if (email !== String(cur.email || '').trim().toLowerCase()) {
    const dupG = await queryOne(`SELECT 1 FROM "GUIAS" WHERE LOWER(TRIM("email"))=$1 AND "_id"<>$2 LIMIT 1`, [email, id]);
    if (dupG) throw new ConflictError('Ese correo ya está en uso por otro guía');
    const dupU = await queryOne(
      `SELECT 1 FROM "USUARIOS_ROLES" WHERE LOWER(TRIM("email"))=$1 ${cur.usuarioRolId ? 'AND "_id"<>$2' : ''} LIMIT 1`,
      cur.usuarioRolId ? [email, cur.usuarioRolId] : [email]
    );
    if (dupU) throw new ConflictError('Ese correo ya está en uso por otro usuario');
  }

  await query(
    `UPDATE "GUIAS" SET
       "primerNombre"=$2, "primerApellido"=$3, "nombreCompleto"=$4, "email"=$5,
       "telefono"=$6, "pais"=$7, "domicilioadvisor"=$8, "zoom"=$9, "fechaNacimiento"=$10,
       "fotoAdvisor"=COALESCE($11, "fotoAdvisor"), "clave"=COALESCE($12, "clave"),
       "_updatedDate"=NOW()
     WHERE "_id"=$1`,
    [id, primerNombre, primerApellido, nombreCompleto, email, telefono, pais, domicilio, zoom, fechaNacimiento, fotoKey, clave]
  );

  // Sincronizar la cuenta de login.
  if (cur.usuarioRolId) {
    await query(
      `UPDATE "USUARIOS_ROLES" SET
         "email"=$2, "nombre"=$3, "apellido"=$4, "numberid"=COALESCE($5,"numberid"),
         "password"=COALESCE($6,"password"), "fechaActualizacion"=NOW(), "_updatedDate"=NOW()
       WHERE "_id"=$1`,
      [cur.usuarioRolId, email, primerNombre, primerApellido, numeroId, clave]
    );
  }

  return successResponse({ message: 'Guía actualizado', _id: id });
});
