import 'server-only';
import { NextResponse } from 'next/server';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { peekOtp } from '@/lib/otp-store';

/**
 * POST /api/auth/forgot-password/verify-otp
 * Verifies the OTP code sent via WhatsApp.
 */
export const POST = handler(async (request) => {
  const { email, code } = await request.json();

  if (!email?.trim()) throw new ValidationError('Email requerido');
  if (!code?.trim())  throw new ValidationError('Código requerido');

  const normalizedEmail = email.trim().toLowerCase();
  // Solo inspecciona (no consume): el OTP se consume en reset-password (P0-6).
  const result = peekOtp(normalizedEmail, code.trim());

  if (!result.valid) {
    return NextResponse.json(
      { success: false, error: 'Código inválido o expirado' },
      { status: 400 }
    );
  }

  return successResponse({ message: 'Código verificado correctamente' });
});
