import 'server-only';
import { NextResponse } from 'next/server';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { verifyOtp, issueResetToken } from '@/lib/otp-store';
import { resolveAccount } from '@/lib/forgot-password-account';

/**
 * POST /api/auth/forgot-password/verify-otp
 *
 * Verifica el OTP enviado por WhatsApp y, si es correcto, EMITE EL TICKET que
 * `reset-password` exige. Ese ticket es lo único que prueba que este paso ocurrió:
 * antes se devolvía sólo un mensaje y el paso 4 no comprobaba nada, así que el
 * flujo entero se podía saltar.
 */
export const POST = handler(async (request) => {
  const { email, code } = await request.json();

  if (!email?.trim()) throw new ValidationError('Ingresa tu email o usuario');
  if (!code?.trim())  throw new ValidationError('Código requerido');

  // Misma llave que usó verify-identity: la CUENTA, no el email.
  const cuenta = await resolveAccount(email);
  if (!cuenta) throw new ValidationError('Código inválido o expirado');

  const result = verifyOtp(cuenta.usuarioRolId, code.trim());

  if (!result.valid) {
    // Tras agotar los intentos el código se invalida: hay que pedir uno nuevo.
    const error = result.reason === 'attempts'
      ? 'Demasiados intentos fallidos. Solicita un código nuevo.'
      : 'Código inválido o expirado';
    return NextResponse.json({ success: false, error }, { status: 400 });
  }

  const resetToken = issueResetToken(cuenta.usuarioRolId);
  return successResponse({ message: 'Código verificado correctamente', resetToken });
});
