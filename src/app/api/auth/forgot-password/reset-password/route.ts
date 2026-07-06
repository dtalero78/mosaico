import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';
import { verifyOtp } from '@/lib/otp-store';
import { hashPassword } from '@/lib/password';

/**
 * POST /api/auth/forgot-password/reset-password
 * Saves the new password in plain text in USUARIOS_ROLES and ACADEMICA.
 */
export const POST = handler(async (request) => {
  const { email, password, confirmPassword, code } = await request.json();

  if (!email?.trim())           throw new ValidationError('Email requerido');
  if (!code?.trim())            throw new ValidationError('Código de verificación requerido');
  if (!password?.trim())        throw new ValidationError('La nueva contraseña es requerida');
  if (!confirmPassword?.trim()) throw new ValidationError('Confirmar contraseña es requerido');
  if (password !== confirmPassword)
    throw new ValidationError('Las contraseñas no coinciden');
  if (/\s/.test(password))
    throw new ValidationError('La contraseña no puede contener espacios');
  if (password.length < 6 || password.length > 10)
    throw new ValidationError('La contraseña debe tener entre 6 y 10 caracteres');

  const normalizedEmail = email.trim().toLowerCase();

  // Verify user exists
  const userRole = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "USUARIOS_ROLES" WHERE LOWER("email") = $1 LIMIT 1`,
    [normalizedEmail]
  );
  if (!userRole) throw new NotFoundError('Usuario', normalizedEmail);

  // P0-6: exigir y CONSUMIR el OTP server-side antes de cambiar la clave.
  // (verify-otp solo inspecciona con peekOtp; la validación real y de un solo uso vive aquí.)
  const otpCheck = verifyOtp(normalizedEmail, code.trim());
  if (!otpCheck.valid)
    throw new ValidationError('Código inválido o expirado. Reinicie el proceso de recuperación.');

  // SEC-PLAINTEXT-PW-09: cifrar antes de guardar (login valida bcrypt + plano).
  const hashed = await hashPassword(password.trim());
  await query(
    `UPDATE "USUARIOS_ROLES" SET "password" = $1, "_updatedDate" = NOW() WHERE LOWER("email") = $2`,
    [hashed, normalizedEmail]
  );

  // Update clave in ACADEMICA
  await query(
    `UPDATE "ACADEMICA" SET "clave" = $1, "_updatedDate" = NOW() WHERE LOWER("email") = $2`,
    [hashed, normalizedEmail]
  ).catch(() => {}); // non-blocking if ACADEMICA email not set

  return successResponse({ message: 'Contraseña actualizada exitosamente' });
});
