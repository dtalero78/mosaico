import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { verifyAndSaveConsent } from '@/services/consent.service';
import { generateAndArchiveContractPdf } from '@/services/contract-archive.service';
import { ValidationError } from '@/lib/errors';

export const POST = handler(async (request, { params }) => {
  const body = await request.json();
  const { otpCode } = body;

  if (!otpCode?.trim() || otpCode.trim().length !== 6) {
    throw new ValidationError('Codigo OTP de 6 digitos es requerido');
  }

  const ip =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';

  const result = await verifyAndSaveConsent(params.id, otpCode.trim(), ip, ua);

  // Al quedar firmado, regenerar y archivar el PDF FINAL (con el bloque de
  // consentimiento) en Drive — el que se archivó al enviar era el de ANTES de la
  // firma. En segundo plano (fire-and-forget): tarda ~10-15s y no debe demorar
  // la confirmación al cliente; MOS_<contrato> se sobreescribe por nombre, así
  // que no genera duplicados. Best-effort: si falla, la firma queda intacta y
  // el PDF puede regenerarse desde Mantenimiento › Generar Contrato.
  generateAndArchiveContractPdf(params.id)
    .then(r => console.log(`📄 [consent/verify] PDF firmado archivado (${params.id}):`, r.ok ? 'OK' : r.reason))
    .catch(err => console.warn(`⚠ [consent/verify] regeneración de PDF falló (${params.id}):`, err?.message || err));

  return successResponse({
    message: 'Consentimiento declarativo registrado exitosamente',
    hash: result.hash,
  });
});
