import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { consumeResetToken } from '@/lib/otp-store';
import { resolveAccount } from '@/lib/forgot-password-account';

/**
 * POST /api/auth/forgot-password/reset-password
 *
 * Último paso. EXIGE el `resetToken` que emite verify-otp tras validar el código:
 * es lo que ata este paso a los anteriores. Sin él, saber un correo bastaba para
 * cambiarle la clave a cualquiera desde internet (el endpoint no consultaba el
 * OTP en ningún momento). El ticket es de un solo uso.
 *
 * Acepta correo o userLogin, y escribe por `_id` de la CUENTA — nunca por email:
 * los hermanos comparten el correo del apoderado (en mosaico-db hay un caso real
 * con dos alumnos), así que un UPDATE por email le cambiaba la clave a ambos.
 */
export const POST = handler(async (request) => {
  const { email, password, confirmPassword, resetToken } = await request.json();

  if (!email?.trim())           throw new ValidationError('Ingresa tu email o usuario');
  if (!resetToken?.trim())      throw new ValidationError('Falta la verificación del código. Reinicia el proceso.');
  if (!password?.trim())        throw new ValidationError('La nueva contraseña es requerida');
  if (!confirmPassword?.trim()) throw new ValidationError('Confirmar contraseña es requerido');
  if (password !== confirmPassword)
    throw new ValidationError('Las contraseñas no coinciden');
  if (/\s/.test(password))
    throw new ValidationError('La contraseña no puede contener espacios');
  if (password.length < 6 || password.length > 10)
    throw new ValidationError('La contraseña debe tener entre 6 y 10 caracteres');

  const cuenta = await resolveAccount(email);
  if (!cuenta) throw new NotFoundError('Usuario', email.trim());

  // PUERTA: sin un ticket válido para ESTA cuenta no se cambia nada. Va ANTES de
  // tocar la BD.
  if (!consumeResetToken(cuenta.usuarioRolId, resetToken.trim())) {
    throw new ValidationError('Verificación inválida o expirada. Vuelve a solicitar el código.');
  }

  const nueva = password.trim();

  // Clave de login (texto plano: el sistema admite ambos formatos — ver PENDIENTE
  // de hashear con bcrypt, que requiere decidir qué pasa con la pantalla del admin
  // que muestra ACADEMICA.clave).
  await query(
    `UPDATE "USUARIOS_ROLES" SET "password" = $1, "_updatedDate" = NOW() WHERE "_id" = $2`,
    [nueva, cuenta.usuarioRolId]
  );

  // Espejo en ACADEMICA, por _id — antes iba por email y le cambiaba la clave a
  // todos los hermanos que compartieran el correo del apoderado.
  if (cuenta.academicaId) {
    await query(
      `UPDATE "ACADEMICA" SET "clave" = $1, "_updatedDate" = NOW() WHERE "_id" = $2`,
      [nueva, cuenta.academicaId]
    ).catch(() => {}); // no bloquea: la clave de login ya quedó actualizada
  }

  return successResponse({ message: 'Contraseña actualizada exitosamente' });
});
