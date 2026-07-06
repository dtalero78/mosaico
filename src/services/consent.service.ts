/**
 * Consent Service
 *
 * Business logic for the Declarative Consent system.
 * Handles OTP generation/verification, consent saving with SHA-256 hash,
 * and admin auto-approval.
 */

import 'server-only';
import { createHash } from 'crypto';
import { PeopleRepository } from '@/repositories/people.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { generateOtp, saveOtp, verifyOtp } from '@/lib/otp-store';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { queryOne } from '@/lib/postgres';

// ── Types ──

interface ConsentData {
  declaracionAceptada: boolean;
  numeroDocumento: string;
  timestampAcceptacion: string;
  ipAddress: string;
  userAgent: string;
  codigoOTPUtilizado: string;
  celularValidado: string;
  tipoAprobacion?: string;
}

// ── Helpers ──

function computeHash(consent: ConsentData): string {
  const json = JSON.stringify(consent);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * DATA-SEQ-09: ¿existe plantilla de contrato para esta plataforma? Sin plantilla, la
 * página pública renderiza un contrato VACÍO que el cliente firmaría por OTP (hash de un
 * documento en blanco). Bloqueamos el flujo de firma cuando falta la plantilla.
 */
async function hasContractTemplate(plataforma: string | null | undefined): Promise<boolean> {
  if (!plataforma || !String(plataforma).trim()) return false;
  const row = await queryOne<{ template: string | null }>(
    `SELECT "template" FROM "ContractTemplates" WHERE LOWER("plataforma") = LOWER($1) LIMIT 1`,
    [plataforma]
  );
  return !!(row && row.template);
}

// ── Public API ──

/**
 * Step 1: Validate document number, generate OTP, and send via WhatsApp.
 */
export async function sendConsentOtp(
  titularId: string,
  numeroDocumento: string
) {
  const person = await PeopleRepository.getConsentData(titularId);
  if (!person) throw new NotFoundError('Titular', titularId);

  if (person.hashConsentimiento) {
    throw new ValidationError('Este contrato ya tiene consentimiento declarativo');
  }

  if (person.numeroId !== numeroDocumento) {
    throw new ValidationError('El numero de documento no coincide');
  }

  // DATA-SEQ-09: no iniciar la firma si no hay plantilla para la plataforma del titular.
  if (!(await hasContractTemplate((person as any).plataforma))) {
    throw new ValidationError(
      'No hay plantilla de contrato configurada para esta plataforma; no se puede firmar. Contacta al área comercial.'
    );
  }

  const celular = person.celular;
  if (!celular) {
    throw new ValidationError('El titular no tiene celular registrado');
  }

  // Generate and store OTP
  const code = generateOtp();
  saveOtp(titularId, code, celular);

  // Send via WhatsApp
  const mensaje =
    `Tu codigo de verificacion MOSAICO es: *${code}*\n\n` +
    `Este codigo expira en 10 minutos. No lo compartas con nadie.`;

  await sendWhatsAppMessage(celular, mensaje);

  // Return masked phone for UI
  const masked = celular.length > 6
    ? celular.slice(0, 3) + '****' + celular.slice(-4)
    : '****' + celular.slice(-4);

  return { celularMasked: masked };
}

/**
 * Step 2: Verify OTP, build consent object, compute SHA-256 hash, save to DB.
 */
export async function verifyAndSaveConsent(
  titularId: string,
  otpCode: string,
  ipAddress: string,
  userAgent: string
) {
  const person = await PeopleRepository.getConsentData(titularId);
  if (!person) throw new NotFoundError('Titular', titularId);

  if (person.hashConsentimiento) {
    throw new ValidationError('Este contrato ya tiene consentimiento declarativo');
  }

  // DATA-SEQ-09 (defensa): no persistir consentimiento de un contrato sin plantilla.
  if (!(await hasContractTemplate((person as any).plataforma))) {
    throw new ValidationError(
      'No hay plantilla de contrato configurada para esta plataforma; no se puede firmar.'
    );
  }

  // Verify OTP
  const result = verifyOtp(titularId, otpCode);
  if (!result.valid) {
    throw new ValidationError('Codigo de verificacion invalido o expirado');
  }

  // Build consent object (mirrors Wix structure)
  const consent: ConsentData = {
    declaracionAceptada: true,
    numeroDocumento: person.numeroId,
    timestampAcceptacion: new Date().toISOString(),
    ipAddress,
    userAgent,
    codigoOTPUtilizado: otpCode,
    celularValidado: result.celular!,
  };

  const hash = computeHash(consent);

  // Persist to PEOPLE table
  await PeopleRepository.saveConsent(
    titularId,
    JSON.stringify(consent),
    hash,
    person.numeroId
  );

  return { hash, consent };
}

/**
 * Admin auto-approval: creates consent without OTP verification.
 */
export async function autoApproveConsent(
  titularId: string,
  adminEmail: string,
  adminName: string,
  ipAddress: string,
  userAgent: string
) {
  const person = await PeopleRepository.getConsentData(titularId);
  if (!person) throw new NotFoundError('Titular', titularId);

  if (person.hashConsentimiento) {
    throw new ValidationError('Este contrato ya tiene consentimiento declarativo');
  }

  const consent: ConsentData = {
    declaracionAceptada: true,
    numeroDocumento: person.numeroId,
    timestampAcceptacion: new Date().toISOString(),
    ipAddress,
    userAgent: `${userAgent} [Admin: ${adminName} <${adminEmail}>]`,
    codigoOTPUtilizado: 'AUTOMATICO',
    celularValidado: person.celular || '',
    tipoAprobacion: 'AUTOMATICA',
  };

  const hash = computeHash(consent);

  await PeopleRepository.saveConsent(
    titularId,
    JSON.stringify(consent),
    hash,
    person.numeroId
  );

  return { hash, consent };
}

/**
 * Get consent status for a titular.
 */
export async function getConsentStatus(titularId: string) {
  const person = await PeopleRepository.getConsentData(titularId);
  if (!person) throw new NotFoundError('Titular', titularId);

  if (person.hashConsentimiento && person.consentimientoDeclarativo) {
    try {
      const consent = JSON.parse(person.consentimientoDeclarativo) as ConsentData;
      return { hasConsent: true, consent, hash: person.hashConsentimiento };
    } catch {
      return { hasConsent: true, consent: null, hash: person.hashConsentimiento };
    }
  }

  return { hasConsent: false, consent: null, hash: null };
}
