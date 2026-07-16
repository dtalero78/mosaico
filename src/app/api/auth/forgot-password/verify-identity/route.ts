import 'server-only';
import { NextResponse } from 'next/server';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { generateOtp, saveOtp } from '@/lib/otp-store';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * ¿El celular escrito corresponde al guardado?
 *
 * Tolerante con el INDICATIVO de país (guardado "56991039009", el alumno suele
 * escribir "991039009") pero exige el número COMPLETO: se aceptan iguales, o que
 * uno sea el otro con un prefijo de 1-3 dígitos.
 *
 * Reemplaza al `endsWith` anterior, que aceptaba con UN SOLO dígito coincidente
 * ("9" pasaba) y convertía este paso en un trámite.
 */
export function celularCoincide(guardadoRaw: string, ingresadoRaw: string): boolean {
  const guardado = (guardadoRaw || '').replace(/\D/g, '');
  const ingresado = (ingresadoRaw || '').replace(/\D/g, '');
  // Un número nacional tiene al menos 8 dígitos: descarta intentos con 1-2.
  if (guardado.length < 8 || ingresado.length < 8) return false;
  if (guardado === ingresado) return true;

  const [largo, corto] = guardado.length >= ingresado.length
    ? [guardado, ingresado]
    : [ingresado, guardado];
  const dif = largo.length - corto.length;
  // Sólo la diferencia de un indicativo (1-3 dígitos) y el resto idéntico.
  return dif >= 1 && dif <= 3 && largo.slice(dif) === corto;
}

/**
 * POST /api/auth/forgot-password/verify-identity
 *
 * Paso 2: verifica que quien pide el restablecimiento conoce el CELULAR
 * registrado. Si coincide → envía el OTP por WhatsApp.
 *
 * El celular no se muestra en pantalla antes de este paso (check-email dejó de
 * devolverlo): si se mostrara, pedirlo aquí no filtraría a nadie. El enmascarado
 * se devuelve AQUÍ, cuando el usuario ya demostró conocerlo, para que el paso del
 * OTP pueda decir a dónde se envió el código.
 *
 * El factor "últimos 4 del documento" se eliminó: además de ser fricción extra,
 * no filtraba nada — `slice(-4)` de un guión da "" y `endsWith("")` es SIEMPRE
 * verdadero, así que cualquier valor pasaba.
 */
export const POST = handler(async (request) => {
  const { email, celular } = await request.json();

  if (!email?.trim())   throw new ValidationError('Email requerido');
  if (!celular?.trim()) throw new ValidationError('El número de celular es requerido');

  const normalizedEmail = email.trim().toLowerCase();

  const academica = await queryOne<{ _id: string; celular: string | null; numeroId: string | null }>(
    `SELECT a."_id", a."celular", a."numeroId"
     FROM "ACADEMICA" a WHERE LOWER(a."email") = $1 LIMIT 1`,
    [normalizedEmail]
  );
  if (!academica) throw new NotFoundError('Registro académico', normalizedEmail);

  if (!celularCoincide(academica.celular || '', celular)) {
    return NextResponse.json(
      { success: false, mismatch: true, error: 'Los datos no coinciden con nuestros registros' },
      { status: 400 }
    );
  }

  // Generar y enviar el OTP
  const celularGuardado = academica.celular!;
  const code = generateOtp();
  saveOtp(normalizedEmail, code, celularGuardado);

  const maskedPhone = celularGuardado.length >= 4
    ? '********' + celularGuardado.slice(-4)
    : celularGuardado;
  const message = `Tu código de verificación MOSAICO para restablecer tu contraseña es: *${code}*\n\nEste código expira en 10 minutos. No lo compartas con nadie.`;

  await sendWhatsAppMessage(celularGuardado, message);

  return successResponse({ maskedPhone, message: 'Código enviado por WhatsApp' });
});
