import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, ConflictError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { generarClave } from '@/lib/password-gen';
import { ROLES_EXCLUIDOS } from '../roles-administrativos/route';

/**
 * POST /api/admin/usuarios-administrativos
 *   { nombre, apellido?, email, celular?, plataforma?, rol }
 * Crea una cuenta de staff en USUARIOS_ROLES (login por email, clave
 * auto-generada). El rol debe existir/estar activo en ROL_PERMISOS y no ser uno
 * de los excluidos (Estudiante/Guía/Comercial). Gateado por CREAR_ROL.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);

  const body = await request.json();
  const nombre = String(body?.nombre || '').trim();
  const apellido = String(body?.apellido || '').trim();
  const email = String(body?.email || '').trim();
  const celular = String(body?.celular || '').trim();
  const plataforma = String(body?.plataforma || '').trim();
  const rol = String(body?.rol || '').trim().toUpperCase();

  if (!nombre) throw new ValidationError('El nombre es obligatorio.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Correo inválido.');
  if (!rol) throw new ValidationError('El rol es obligatorio.');
  if (ROLES_EXCLUIDOS.includes(rol)) throw new ValidationError(`El rol ${rol} tiene su propio flujo (no es administrativo).`);

  // El rol debe existir y estar activo en ROL_PERMISOS.
  const rolRow = await queryOne<{ rol: string }>(
    `SELECT "rol" FROM "ROL_PERMISOS" WHERE "rol" = $1 AND "activo" = true LIMIT 1`, [rol]
  );
  if (!rolRow) throw new ValidationError(`Rol inválido o inactivo: ${rol}.`);

  // El correo no puede estar ya en uso como login.
  const existing = await queryOne<{ rol: string; activo: boolean | null }>(
    `SELECT "rol","activo" FROM "USUARIOS_ROLES" WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );
  if (existing) {
    throw new ConflictError(`Ya hay una cuenta con ese correo (rol ${existing.rol}${existing.activo === false ? ', INACTIVA' : ''}).`);
  }

  const clave = generarClave();
  const usuarioRolId = generateId('usr');

  await query(
    `INSERT INTO "USUARIOS_ROLES" (
       "_id","email","nombre","apellido","password","rol",
       "activo","celular","plataforma","origen","fechaCreacion","fechaActualizacion","_createdDate","_updatedDate"
     ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,'ADMIN',NOW(),NOW(),NOW(),NOW())`,
    [usuarioRolId, email, nombre, apellido || null, clave, rol, celular || null, plataforma || null]
  );

  return successResponse({
    usuario: { _id: usuarioRolId, nombre, apellido, email, rol, plataforma: plataforma || null },
    clave,
    message: 'Usuario administrativo creado.',
  });
});
