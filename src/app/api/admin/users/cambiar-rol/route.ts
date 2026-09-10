/**
 * POST /api/admin/users/cambiar-rol   { usuarioRolId, rolNuevo, motivo }
 * GET  /api/admin/users/cambiar-rol?usuarioRolId=  → historial de esa cuenta
 *
 * Cambia el rol de una cuenta de login existente. Cambiar el rol cambia lo que
 * esa persona ve y puede hacer en TODA la plataforma, así que va con permiso
 * propio (no el de crear usuarios), con motivo obligatorio y dejando bitácora.
 *
 * Las cuatro guardas son de escalación de privilegios, y viven en el SERVIDOR
 * —no en lo que la pantalla ofrezca—, porque son justamente lo que alguien
 * intentaría saltarse llamando al endpoint directo:
 *
 *   1. Nadie cambia su PROPIO rol.
 *   2. No se puede ASIGNAR ADMIN ni SUPER_ADMIN; esos siguen dándose desde
 *      /admin/permissions, que es donde vive esa decisión.
 *   3. No se puede tocar a QUIEN YA es ADMIN o SUPER_ADMIN — si no, desde aquí
 *      se podría degradar a un administrador y dejarlo fuera.
 *   4. El rol destino tiene que existir en ROL_PERMISOS: un rol inventado
 *      dejaría la cuenta sin ningún permiso resoluble.
 *
 * ⚠ El rol viaja en el JWT de NextAuth: quien esté con sesión abierta la
 * conserva con el rol viejo hasta que vuelva a entrar. El cambio es inmediato
 * en la base, no en la sesión que ya está andando.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne, queryMany, withTransaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';

/** Roles que ni se asignan ni se tocan desde aquí. */
const ROLES_INTOCABLES = ['SUPER_ADMIN', 'ADMIN'];

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CAMBIAR_ROL);
  const id = (new URL(request.url).searchParams.get('usuarioRolId') || '').trim();
  if (!id) throw new ValidationError('usuarioRolId es requerido');

  const historial = await queryMany(
    `SELECT "rolAnterior", "rolNuevo", "motivo", "realizadoPor", "realizadoPorNombre", "_createdDate"
       FROM "ROL_CAMBIOS_AUDIT" WHERE "usuarioRolId" = $1 ORDER BY "_createdDate" DESC LIMIT 50`,
    [id]
  );
  return successResponse({ historial });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CAMBIAR_ROL);

  const body = await request.json();
  const usuarioRolId = String(body?.usuarioRolId || '').trim();
  const rolNuevo = String(body?.rolNuevo || '').trim().toUpperCase();
  const motivo = String(body?.motivo || '').trim();

  if (!usuarioRolId) throw new ValidationError('Elige el usuario');
  if (!rolNuevo) throw new ValidationError('Elige el rol nuevo');
  if (!motivo) throw new ValidationError('Escribe el motivo del cambio');

  const u = await queryOne<{ _id: string; email: string | null; nombre: string | null;
    apellido: string | null; rol: string | null }>(
    `SELECT "_id", "email", "nombre", "apellido", "rol" FROM "USUARIOS_ROLES" WHERE "_id" = $1`,
    [usuarioRolId]
  );
  if (!u) throw new NotFoundError('Usuario', usuarioRolId);

  // (1) Nadie se cambia el rol a sí mismo. Se compara por id Y por correo: el
  // admin de variables de entorno no tiene fila, así que su id no coincidiría.
  const yoId = (session?.user as any)?.id || '';
  const yoMail = String(session?.user?.email || '').trim().toLowerCase();
  if (usuarioRolId === yoId || (yoMail && String(u.email || '').trim().toLowerCase() === yoMail)) {
    throw new ValidationError('No puedes cambiar tu propio rol. Pídeselo a otro administrador.');
  }

  // (2) y (3) — ni asignar ni tocar cuentas de administración.
  if (ROLES_INTOCABLES.includes(rolNuevo)) {
    throw new ValidationError(
      `${rolNuevo} no se asigna desde aquí. Ese rol se gestiona en /admin/permissions.`
    );
  }
  const rolActual = String(u.rol || '').trim().toUpperCase();
  if (ROLES_INTOCABLES.includes(rolActual)) {
    throw new ValidationError(
      `Esta cuenta es ${rolActual} y su rol no se cambia desde aquí, para no dejar sin acceso a un administrador.`
    );
  }

  if (rolActual === rolNuevo) {
    throw new ValidationError(`La cuenta ya tiene el rol ${rolNuevo}.`);
  }

  // (4) El rol destino tiene que existir en el catálogo.
  const existe = await queryOne(`SELECT 1 FROM "ROL_PERMISOS" WHERE "rol" = $1`, [rolNuevo]);
  if (!existe) throw new ValidationError(`El rol ${rolNuevo} no existe en el catálogo de roles.`);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45)
    || request.headers.get('x-real-ip') || null;

  // Bitácora y cambio, juntos: un cambio sin registro no debe poder quedar.
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO "ROL_CAMBIOS_AUDIT"
         ("_id","usuarioRolId","usuarioEmail","usuarioNombre","rolAnterior","rolNuevo",
          "motivo","realizadoPor","realizadoPorNombre","ip")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ids.audit(), u._id, u.email, [u.nombre, u.apellido].filter(Boolean).join(' ') || null,
       u.rol || null, rolNuevo, motivo,
       session?.user?.email || 'desconocido', session?.user?.name || null, ip]
    );
    await client.query(
      `UPDATE "USUARIOS_ROLES" SET "rol" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [u._id, rolNuevo]
    );
  });

  return successResponse({
    usuario: { _id: u._id, email: u.email, nombre: [u.nombre, u.apellido].filter(Boolean).join(' ') },
    rolAnterior: u.rol || null,
    rolNuevo,
    message: `Rol cambiado de ${u.rol || '(sin rol)'} a ${rolNuevo}. Si esa persona tiene la sesión abierta, el cambio le aplica cuando vuelva a entrar.`,
  });
});
