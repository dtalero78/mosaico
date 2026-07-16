import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { resolveAccount } from '@/lib/forgot-password-account';

/**
 * POST /api/auth/forgot-password/check-email
 *
 * Paso 1: comprueba que exista la cuenta. Acepta el CORREO o el USUARIO
 * (userLogin) — los estudiantes entran con su userLogin, así que exigir el email
 * dejaba fuera a la mayoría.
 *
 * NO devuelve el celular (ni enmascarado): el paso siguiente lo PIDE para
 * verificar la identidad, así que darlo aquí sería regalar la respuesta.
 */
export const POST = handler(async (request) => {
  const { email } = await request.json();

  if (!email?.trim()) throw new ValidationError('Ingresa tu email o usuario');

  const cuenta = await resolveAccount(email);
  if (!cuenta) throw new NotFoundError('Usuario', email.trim());

  // Sin celular no hay a dónde enviar el código: se avisa aquí y no en el paso 2.
  if (!cuenta.celular) {
    throw new ValidationError(
      'Tu cuenta no tiene un celular registrado. Contacta a soporte para restablecer tu contraseña.'
    );
  }

  return successResponse({ hasPhone: true });
});
