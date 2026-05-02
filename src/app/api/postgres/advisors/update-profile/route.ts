import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError, NotFoundError } from '@/lib/errors';

const ALPHANUMERIC = /^[a-zA-Z0-9]+$/;
const EMAIL_REGEX   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/postgres/advisors/update-profile
 *
 * One-time profile update for advisors (and reusable for other roles).
 * Updates: email, numberid, password, celular, domicilio, foto.
 * Sets USUARIOS_ROLES.perfilActualizado = NOW() to prevent showing the screen again.
 *
 * Body: { email, numberId, password, celular, domicilio, fotoKey }
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const sessionEmail = session.user?.email;
  if (!sessionEmail) throw new ValidationError('No se encontró email en la sesión');

  const body = await request.json();
  const { email, numberId, password, celular, domicilio, fotoKey } = body;

  // ── Validations ──────────────────────────────────────────────────────────
  if (!email?.trim())    throw new ValidationError('El email es requerido');
  if (!numberId?.trim()) throw new ValidationError('El número de identificación es requerido');
  if (!password?.trim()) throw new ValidationError('La clave es requerida');
  if (!celular?.trim())  throw new ValidationError('El celular es requerido');
  if (!domicilio?.trim()) throw new ValidationError('El domicilio es requerido');

  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail)) throw new ValidationError('Formato de email inválido');

  const cleanId = numberId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ALPHANUMERIC.test(cleanId)) throw new ValidationError('El número de ID solo permite letras y números');

  const cleanPass = password.trim();
  if (cleanPass.length < 6 || cleanPass.length > 10) {
    throw new ValidationError('La clave debe tener entre 6 y 10 caracteres');
  }
  if (/\s/.test(cleanPass)) throw new ValidationError('La clave no puede contener espacios');

  // ── Find USUARIOS_ROLES record by session email ───────────────────────────
  const userRole = await queryOne<{ _id: string; rol: string }>(
    `SELECT "_id", "rol" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
    [sessionEmail]
  );
  if (!userRole) throw new NotFoundError('Usuario', sessionEmail);

  // ── Find ADVISORS record by session email ─────────────────────────────────
  const advisor = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "ADVISORS" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
    [sessionEmail]
  );
  if (!advisor) throw new NotFoundError('Advisor', sessionEmail);

  // ── Hash password ─────────────────────────────────────────────────────────
  // Save password as plain text (system supports both bcrypt and plain text — auth-postgres.ts)
  const hashedPassword = cleanPass;

  // ── Update USUARIOS_ROLES ─────────────────────────────────────────────────
  await query(
    `UPDATE "USUARIOS_ROLES"
     SET "email"             = $1,
         "numberid"          = $2,
         "password"          = $3,
         "celular"           = $4,
         "perfilActualizado" = NOW(),
         "_updatedDate"      = NOW()
     WHERE "_id" = $5`,
    [normalizedEmail, cleanId, hashedPassword, celular.trim(), userRole._id]
  );

  // ── Update ADVISORS ───────────────────────────────────────────────────────
  await query(
    `UPDATE "ADVISORS"
     SET "email"              = $1,
         "telefono"           = $2,
         "domicilioadvisor"   = $3,
         "fotoAdvisor"        = $4,
         "_updatedDate"       = NOW()
     WHERE "_id" = $5`,
    [
      normalizedEmail,
      celular.trim(),
      domicilio.trim(),
      fotoKey || null,
      advisor._id,
    ]
  );

  return successResponse({ message: 'Perfil actualizado exitosamente' });
});
