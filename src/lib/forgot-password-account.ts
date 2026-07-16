import 'server-only';
import { queryOne } from '@/lib/postgres';

/**
 * Resuelve la cuenta a recuperar desde lo que el usuario escribe: su CORREO o su
 * USUARIO (userLogin).
 *
 * Por qué existe:
 *  - Los estudiantes entran con su `userLogin` (auth-postgres acepta
 *    `email OR userLogin`), pero la recuperación sólo buscaba por email → quien
 *    sólo recordaba su usuario no podía recuperar la clave.
 *  - El email NO identifica a una persona: los hermanos comparten el correo del
 *    apoderado (verificado en mosaico-db: macacifuentes22@gmail.com apunta a DOS
 *    alumnos en ACADEMICA). Buscar por email con LIMIT 1 elegía uno al azar, y
 *    actualizar por email le cambiaba la clave a los dos.
 *  - El `userLogin` sí es único (232/232 en ACADEMICA, sin repetidos), así que
 *    todo el flujo se ancla a la CUENTA resuelta y sus `_id`, nunca al email.
 */

export interface CuentaRecuperacion {
  /** USUARIOS_ROLES._id — llave del flujo (única y estable). */
  usuarioRolId: string;
  /** Identificador de login de la cuenta. */
  userLogin: string | null;
  /** Correo de la cuenta (puede estar compartido entre hermanos). */
  email: string | null;
  activo: boolean | null;
  /** ACADEMICA._id del alumno (null si es staff/titular sin ficha académica). */
  academicaId: string | null;
  /** Celular al que se envía el OTP. */
  celular: string | null;
}

/**
 * Busca la cuenta por email O userLogin (ambos case-insensitive y sin espacios).
 * Devuelve null si no existe.
 */
export async function resolveAccount(identificador: string): Promise<CuentaRecuperacion | null> {
  const id = (identificador || '').trim().toLowerCase();
  if (!id) return null;

  // USUARIOS_ROLES es la fuente de la CUENTA: su email es único (verificado, 0
  // repetidos) y el userLogin también. Si aquí no está, no hay cuenta que recuperar.
  const user = await queryOne<{ _id: string; email: string | null; userLogin: string | null; activo: boolean | null }>(
    `SELECT "_id", "email", "userLogin", "activo"
       FROM "USUARIOS_ROLES"
      WHERE LOWER(TRIM("email")) = $1 OR LOWER(TRIM("userLogin")) = $1
      LIMIT 1`,
    [id]
  );
  if (!user) return null;

  // El celular vive en ACADEMICA. Se busca por userLogin (único); sólo se cae al
  // email si la cuenta no tiene userLogin, y aun así se exige que ese email
  // apunte a UN solo registro — si lo comparten hermanos, no se puede saber cuál
  // es y se prefiere no arriesgar.
  let academica: { _id: string; celular: string | null } | null = null;

  if (user.userLogin) {
    academica = await queryOne<{ _id: string; celular: string | null }>(
      `SELECT "_id", "celular" FROM "ACADEMICA" WHERE LOWER(TRIM("userLogin")) = $1 LIMIT 1`,
      [user.userLogin.trim().toLowerCase()]
    );
  }
  if (!academica && user.email) {
    const porEmail = await queryOne<{ _id: string; celular: string | null; n: string }>(
      `SELECT "_id", "celular", (SELECT COUNT(*) FROM "ACADEMICA" WHERE LOWER(TRIM("email")) = $1)::text AS n
         FROM "ACADEMICA" WHERE LOWER(TRIM("email")) = $1 LIMIT 1`,
      [user.email.trim().toLowerCase()]
    );
    // Ambiguo (email compartido) → no se resuelve por email.
    if (porEmail && porEmail.n === '1') academica = { _id: porEmail._id, celular: porEmail.celular };
  }

  return {
    usuarioRolId: user._id,
    userLogin: user.userLogin,
    email: user.email,
    activo: user.activo,
    academicaId: academica?._id ?? null,
    celular: academica?.celular ?? null,
  };
}
