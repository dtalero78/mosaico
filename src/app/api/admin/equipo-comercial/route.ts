import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, ConflictError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

const ROLES_COMERCIAL = ['COMERCIAL', 'COMERCIAL_JEFE'];

/** Genera una clave legible de 10 caracteres (sin caracteres ambiguos). */
function generarClave(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const buf = require('crypto').randomBytes(10);
  for (let i = 0; i < 10; i++) out += chars[buf[i] % chars.length];
  return out;
}

/**
 * POST /api/admin/equipo-comercial
 *   { nombre, correo, plataforma, filial, rol }  (rol: COMERCIAL | COMERCIAL_JEFE)
 * Crea la persona en EQUIPO_COMERCIAL + su login en USUARIOS_ROLES (por correo,
 * clave auto-generada). Devuelve la clave para compartirla.
 * Gateado por MANTENIMIENTO.USUARIOS.CREAR_ROL.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);

  const body = await request.json();
  const nombre = String(body?.nombre || '').trim();
  const correo = String(body?.correo || '').trim();
  const plataforma = String(body?.plataforma || '').trim();
  const filial = String(body?.filial || '').trim();
  const rol = String(body?.rol || 'COMERCIAL').trim().toUpperCase();

  if (!nombre) throw new ValidationError('El nombre es obligatorio.');
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new ValidationError('Correo inválido.');
  if (!plataforma) throw new ValidationError('La plataforma es obligatoria.');
  if (!ROLES_COMERCIAL.includes(rol)) throw new ValidationError('Rol inválido (COMERCIAL | COMERCIAL_JEFE).');

  // El correo no puede estar ya en uso como login.
  const existing = await queryOne<{ rol: string; activo: boolean | null }>(
    `SELECT "rol","activo" FROM "USUARIOS_ROLES" WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`,
    [correo]
  );
  if (existing) {
    throw new ConflictError(`Ya hay una cuenta con ese correo (rol ${existing.rol}${existing.activo === false ? ', INACTIVA' : ''}).`);
  }

  const clave = generarClave();
  const usuarioRolId = generateId('usr');
  const comercialId = generateId('com');

  // 1) Login en USUARIOS_ROLES (por correo, activo).
  await query(
    `INSERT INTO "USUARIOS_ROLES" (
       "_id","email","nombre","apellido","password","rol",
       "activo","plataforma","origen","fechaCreacion","fechaActualizacion","_createdDate","_updatedDate"
     ) VALUES ($1,$2,$3,'',$4,$5,true,$6,'ADMIN',NOW(),NOW(),NOW(),NOW())`,
    [usuarioRolId, correo.trim(), nombre, clave, rol, plataforma]
  );

  // 2) Fila en EQUIPO_COMERCIAL enlazada al login.
  await query(
    `INSERT INTO "EQUIPO_COMERCIAL" (
       "_id","nombre","correo","plataforma","filial","clave","rol","usuarioRolId","activo","origen","_createdDate","_updatedDate"
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'ADMIN',NOW(),NOW())`,
    [comercialId, nombre, correo.trim(), plataforma, filial || null, clave, rol, usuarioRolId]
  );

  return successResponse({
    comercial: { _id: comercialId, nombre, correo, plataforma, filial: filial || null, rol },
    clave, // se muestra una sola vez para compartir
    message: 'Comercial creado con login.',
  });
});
