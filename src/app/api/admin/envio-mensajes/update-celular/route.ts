/**
 * PATCH /api/admin/envio-mensajes/update-celular
 *
 * Actualiza el celular de un estudiante en 3 tablas sincronizadas:
 *   - PEOPLE      (por numeroId)
 *   - ACADEMICA   (por numeroId)
 *   - USUARIOS_ROLES (por userLogin de la ficha o documento; nunca por correo)
 *
 * Body: { numeroId: string, celular: string }
 *
 * Validaciones:
 *   - celular debe pasar formatPhoneNumber (>= 10 dígitos)
 *   - numeroId normalizado existe en ACADEMICA
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';
import { normalizeNumeroId } from '@/lib/numeroid-normalize';
import { formatPhoneNumber } from '@/lib/whatsapp';

export const PATCH = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.ENVIO_MENSAJES);

  const body = await request.json();
  const numeroIdNorm = normalizeNumeroId(body?.numeroId);
  if (!numeroIdNorm) throw new ValidationError('numeroId requerido');

  const celular = String(body?.celular || '').trim();
  if (!celular) throw new ValidationError('celular requerido');
  // formatPhoneNumber lanza si <10 dígitos
  const celularClean = formatPhoneNumber(celular);

  // Verifico que el estudiante existe en ACADEMICA (con normalización)
  const aca = await queryOne<{ _id: string; email: string | null; numeroId: string }>(
    `SELECT "_id", "email", "numeroId"
     FROM "ACADEMICA"
     WHERE UPPER(REGEXP_REPLACE(COALESCE("numeroId",''), '[.\\s\\-_]', '', 'g')) = $1
     ORDER BY CASE WHEN "tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END,
              "_createdDate" DESC NULLS LAST
     LIMIT 1`,
    [numeroIdNorm],
  );
  if (!aca) throw new NotFoundError('ACADEMICA', `numeroId=${numeroIdNorm}`);

  // Update sincronizado — todos los registros que matcheen el numeroId normalizado
  const updatePeople = await query(
    `UPDATE "PEOPLE"
       SET "celular" = $1, "_updatedDate" = NOW()
     WHERE UPPER(REGEXP_REPLACE(COALESCE("numeroId",''), '[.\\s\\-_]', '', 'g')) = $2`,
    [celularClean, numeroIdNorm],
  );
  const updateAcademica = await query(
    `UPDATE "ACADEMICA"
       SET "celular" = $1, "_updatedDate" = NOW()
     WHERE UPPER(REGEXP_REPLACE(COALESCE("numeroId",''), '[.\\s\\-_]', '', 'g')) = $2`,
    [celularClean, numeroIdNorm],
  );

  // USUARIOS_ROLES por IDENTIDAD —el userLogin de su ficha académica o su
  // documento—, nunca por correo: los hermanos comparten el del apoderado y el
  // celular de uno quedaba en la cuenta del otro. Sólo cuentas de estudiante.
  const updateUsuariosRoles = await query(
    `UPDATE "USUARIOS_ROLES"
       SET "celular" = $1, "_updatedDate" = NOW()
     WHERE "rol" = 'ESTUDIANTE'
       AND ("userLogin" IN (SELECT "userLogin" FROM "ACADEMICA"
                             WHERE UPPER(REGEXP_REPLACE(COALESCE("numeroId",''), '[.\\s\\-_]', '', 'g')) = $2
                               AND "userLogin" IS NOT NULL)
            OR UPPER(REGEXP_REPLACE(COALESCE("numberid",''), '[.\\s\\-_]', '', 'g')) = $2)`,
    [celularClean, numeroIdNorm],
  );

  return successResponse({
    celular: celularClean,
    afectados: {
      people: updatePeople.rowCount ?? 0,
      academica: updateAcademica.rowCount ?? 0,
      usuariosRoles: updateUsuariosRoles.rowCount ?? 0,
    },
  });
});
