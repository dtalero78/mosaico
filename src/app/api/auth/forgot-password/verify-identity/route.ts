import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { generateOtp, saveOtp } from '@/lib/otp-store';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * POST /api/auth/forgot-password/verify-identity
 * Verifies last 4 digits of ID and last 4 digits of phone.
 * If match → sends OTP via WhatsApp.
 * If no match → returns 400 (caller shows mismatch modal).
 */
export const POST = handler(async (request) => {
  const { email, lastFourId, lastFourPhone } = await request.json();

  if (!email?.trim())        throw new ValidationError('Email requerido');
  if (!lastFourId?.trim())   throw new ValidationError('Últimos 4 dígitos del ID requeridos');
  if (!lastFourPhone?.trim()) throw new ValidationError('Últimos 4 dígitos del celular requeridos');

  const normalizedEmail = email.trim().toLowerCase();
  const cleanId    = lastFourId.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(-4);
  const cleanPhone = lastFourPhone.replace(/\D/g, '');  // full number, no signs

  // Get ACADEMICA record — also check PEOPLE for celular fallback
  const academica = await queryOne<{ _id: string; celular: string | null; numeroId: string | null }>(
    `SELECT a."_id", a."celular", a."numeroId"
     FROM "ACADEMICA" a WHERE LOWER(a."email") = $1 LIMIT 1`,
    [normalizedEmail]
  );
  if (!academica) throw new NotFoundError('Registro académico', normalizedEmail);

  // Verify last 4 of ID
  const storedId = (academica.numeroId || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const idMatches = storedId.endsWith(cleanId);

  // Verify phone — flexible: stored may or may not include country code
  // Accept if stored ends with input OR input ends with stored (handles 57XXXXXXXXXX vs XXXXXXXXXX)
  const storedPhone = (academica.celular || '').replace(/\D/g, '');
  const phoneMatches = storedPhone !== '' && cleanPhone !== '' && (
    storedPhone === cleanPhone ||
    storedPhone.endsWith(cleanPhone) ||
    cleanPhone.endsWith(storedPhone)
  );

  if (!idMatches || !phoneMatches) {
    // Return mismatch — client will show modal
    return new Response(
      JSON.stringify({ success: false, mismatch: true, error: 'Los datos no coinciden con nuestros registros' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Generate and send OTP
  const celular = academica.celular!;
  const code = generateOtp();
  saveOtp(normalizedEmail, code, celular);

  const maskedPhone = celular.length >= 4 ? '********' + celular.slice(-4) : celular;
  const message = `Tu código de verificación LetsGoSpeak para restablecer tu contraseña es: *${code}*\n\nEste código expira en 10 minutos. No lo compartas con nadie.`;

  await sendWhatsAppMessage(celular, message);

  return successResponse({ maskedPhone, message: 'Código enviado por WhatsApp' });
});
