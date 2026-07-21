import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryMany } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';

/**
 * GET /api/admin/users/consulta            → { roles: [{ rol, n }] }  (para el dropdown)
 * GET /api/admin/users/consulta?rol=X      → { usuarios: [...] }
 *
 * Consulta de cuentas de login (USUARIOS_ROLES) por rol, con email, nombre, id,
 * usuario (userLogin) y clave (password). Gateado por MANTENIMIENTO.USUARIOS.CREAR_ROL
 * (SUPER_ADMIN/ADMIN bypass), igual que el hub Crear Usuarios.
 *
 * NOTA: expone la clave en texto plano — consistente con el resto de la app
 * (las claves son legacy en texto plano y ya se muestran a los admins, p.ej.
 * "Clave Login" en /student). Sólo accesible con el permiso de arriba.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);

  const rol = (new URL(request.url).searchParams.get('rol') || '').trim();

  if (!rol) {
    const roles = await queryMany(
      `SELECT "rol", COUNT(*)::int AS "n"
         FROM "USUARIOS_ROLES"
        WHERE "rol" IS NOT NULL AND "rol" <> ''
        GROUP BY "rol"
        ORDER BY "rol"`,
    );
    return successResponse({ roles });
  }

  const usuarios = await queryMany(
    `SELECT "_id", "email", "userLogin", "nombre", "apellido", "password",
            "numberid", "rol", "activo"
       FROM "USUARIOS_ROLES"
      WHERE "rol" = $1
      ORDER BY "nombre" NULLS LAST, "apellido" NULLS LAST, "email" NULLS LAST`,
    [rol],
  );
  return successResponse({ usuarios });
});
