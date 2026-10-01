import 'server-only';
import { queryOne, withTransaction } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { normalizeTelefonoOrNull } from '@/lib/telefono-normalize';

/**
 * Acciones por fila de Gestión de Usuarios (Mantenimiento › Usuarios › consulta
 * por rol): Editar, Clave y Eliminar sobre una cuenta de USUARIOS_ROLES.
 *
 * Las guardas son las mismas que "Cambiar rol" y viven aquí, en el servidor,
 * porque son justo lo que alguien intentaría saltarse llamando al endpoint:
 *   - Una cuenta ADMIN o SUPER_ADMIN no se toca desde aquí: cambiarle la clave
 *     o el email sería quedarse con el acceso de un administrador.
 *   - Nadie elimina su propia cuenta.
 */

const ROLES_INTOCABLES = ['SUPER_ADMIN', 'ADMIN'];

export interface Actor { email: string; nombre: string | null; id: string; ip: string; userAgent: string }

interface Cuenta {
  _id: string; email: string | null; nombre: string | null; apellido: string | null;
  rol: string | null; userLogin: string | null; numberid: string | null; contrato: string | null;
}

async function cargarCuenta(id: string): Promise<Cuenta> {
  const u = await queryOne<Cuenta>(
    `SELECT "_id","email","nombre","apellido","rol","userLogin","numberid","contrato"
       FROM "USUARIOS_ROLES" WHERE "_id" = $1`,
    [id]
  );
  if (!u) throw new NotFoundError('Usuario', id);
  const rol = String(u.rol || '').trim().toUpperCase();
  if (ROLES_INTOCABLES.includes(rol)) {
    throw new ValidationError(`Esta cuenta es ${rol}: no se modifica desde aquí, para no comprometer el acceso de un administrador.`);
  }
  return u;
}

const esMiCuenta = (u: Cuenta, actor: Actor) =>
  u._id === actor.id || (!!actor.email && String(u.email || '').trim().toLowerCase() === actor.email.trim().toLowerCase());

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DatosEdicion {
  nombre?: string | null; apellido?: string | null; email?: string | null;
  celular?: string | null; plataforma?: string | null; activo?: boolean;
}

export async function editarUsuario(id: string, datos: DatosEdicion) {
  const u = await cargarCuenta(id);
  const sets: string[] = [];
  const vals: any[] = [id];
  const set = (col: string, v: any) => { vals.push(v); sets.push(`"${col}" = $${vals.length}`); };

  if (datos.nombre !== undefined) {
    const v = String(datos.nombre || '').trim();
    if (!v) throw new ValidationError('El nombre no puede quedar vacío.');
    set('nombre', v);
  }
  if (datos.apellido !== undefined) set('apellido', String(datos.apellido || '').trim() || null);

  let emailNuevo: string | null = null;
  if (datos.email !== undefined) {
    const v = String(datos.email || '').trim().toLowerCase();
    if (!EMAIL_RX.test(v)) throw new ValidationError('El email no es válido.');
    // El personal entra con su email, así que dos cuentas no pueden compartirlo.
    // Un estudiante entra con su usuario y el email es del apoderado (los
    // hermanos lo comparten): ahí no se exige que sea único.
    if (String(u.rol || '').toUpperCase() !== 'ESTUDIANTE') {
      const otro = await queryOne<{ nombre: string | null; rol: string | null }>(
        `SELECT "nombre","rol" FROM "USUARIOS_ROLES"
          WHERE LOWER(TRIM("email")) = $1 AND "_id" <> $2 LIMIT 1`,
        [v, id]
      );
      if (otro) throw new ValidationError(`Ese email ya lo usa otra cuenta (${otro.nombre || 'sin nombre'}, ${otro.rol || 'sin rol'}).`);
    }
    if (v !== String(u.email || '').trim().toLowerCase()) emailNuevo = v;
    set('email', v);
  }
  if (datos.celular !== undefined) set('celular', normalizeTelefonoOrNull(datos.celular));
  if (datos.plataforma !== undefined) set('plataforma', String(datos.plataforma || '').trim() || null);
  if (datos.activo !== undefined) set('activo', datos.activo === true);

  if (!sets.length) throw new ValidationError('No hay cambios para guardar.');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE "USUARIOS_ROLES" SET ${sets.join(', ')}, "_updatedDate" = NOW() WHERE "_id" = $1`, vals
    );
    // Al guía se le reconoce por su EMAIL (sesión → ficha de GUIAS): si cambia
    // aquí y no allá, deja de ver su panel y sus cursos.
    if (emailNuevo && String(u.rol || '').toUpperCase() === 'GUIA') {
      await client.query(
        `UPDATE "GUIAS" SET "email" = $2, "_updatedDate" = NOW()
          WHERE "usuarioRolId" = $1 OR (LOWER(TRIM("email")) = LOWER(TRIM($3)) AND $3 <> '')`,
        [id, emailNuevo, u.email || '']
      );
    }
  });
  return { ok: true };
}

export async function cambiarClave(id: string, clave: string) {
  const u = await cargarCuenta(id);
  const v = String(clave || '');
  if (v.length < 6 || v.length > 40) throw new ValidationError('La clave debe tener entre 6 y 40 caracteres.');
  if (/\s/.test(v)) throw new ValidationError('La clave no puede tener espacios.');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE "USUARIOS_ROLES" SET "password" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`, [id, v]
    );
    // El estudiante tiene la clave también en su registro académico (se muestra
    // como "Clave Login" en su ficha y la usa la recuperación de clave): se
    // alinean las dos. Se resuelve por su usuario, nunca por email (hermanos).
    // La ficha del guía guarda su clave (se muestra en su edición): igual.
    if (String(u.rol || '').toUpperCase() === 'GUIA') {
      await client.query(
        `UPDATE "GUIAS" SET "clave" = $2, "_updatedDate" = NOW()
          WHERE "usuarioRolId" = $1 OR (LOWER(TRIM("email")) = LOWER(TRIM($3)) AND $3 <> '')`,
        [id, v, u.email || '']
      );
    }
    if (String(u.rol || '').toUpperCase() === 'ESTUDIANTE') {
      if (u.userLogin) {
        await client.query(`UPDATE "ACADEMICA" SET "clave" = $2, "_updatedDate" = NOW() WHERE "userLogin" = $1`, [u.userLogin, v]);
      } else if (u.numberid) {
        await client.query(
          `UPDATE "ACADEMICA" SET "clave" = $2, "_updatedDate" = NOW()
            WHERE UPPER(TRIM("numeroId")) = UPPER(TRIM($1))`, [u.numberid, v]
        );
      }
    }
  });
  return { ok: true };
}

export async function eliminarUsuario(id: string, motivo: string, actor: Actor) {
  const u = await cargarCuenta(id);
  if (esMiCuenta(u, actor)) throw new ValidationError('No puedes eliminar tu propia cuenta.');
  const m = String(motivo || '').trim();
  if (!m) throw new ValidationError('Escribe el motivo de la eliminación.');

  await withTransaction(async (client) => {
    const snap = await client.query(`SELECT * FROM "USUARIOS_ROLES" WHERE "_id" = $1`, [id]);
    // Copia completa ANTES de borrar: desde la pantalla no se deshace, pero se
    // puede reconstruir a mano.
    await client.query(
      `INSERT INTO "PURGE_LOG"
         ("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo",
          "realizadoPor","realizadoPorNombre","ip","userAgent","filasBorradas")
       VALUES ($1,'USUARIO_ROL',$2,NULL,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb)`,
      [ids.audit(), u.contrato || null, [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email,
       JSON.stringify({ usuariosRoles: snap.rows }), m, actor.email, actor.nombre,
       actor.ip.slice(0, 45), actor.userAgent, JSON.stringify({ usuariosRoles: snap.rowCount })]
    );
    // La ficha del guía apunta a su cuenta: se suelta el enlace en vez de dejarlo
    // colgando de una cuenta que ya no existe.
    await client.query(`UPDATE "GUIAS" SET "usuarioRolId" = NULL WHERE "usuarioRolId" = $1`, [id]);
    await client.query(`DELETE FROM "USUARIOS_ROLES" WHERE "_id" = $1`, [id]);
  });
  return { ok: true };
}
