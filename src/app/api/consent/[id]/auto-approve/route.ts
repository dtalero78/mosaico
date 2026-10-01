import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { autoApproveConsent, registrarAuditoriaAutoaprobacion } from '@/services/consent.service';
import { generateAndArchiveContractPdf } from '@/services/contract-archive.service';
import { queryOne } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';

export const POST = handlerWithAuth(async (request, { params }, session) => {
  // "Acción Administrativa": por perfil; SUPER_ADMIN/ADMIN bypassean.
  await requirePermission(session, ComercialPermission.APROBACION_AUTONOMA);

  // Contrato de prueba (PRB-): no se puede auto-aprobar (defensa server-side
  // además de ocultar el botón en la UI). Se verifica ANTES de guardar el consentimiento.
  const prb = await queryOne<{ contrato: string | null }>(
    `SELECT "contrato" FROM "PEOPLE" WHERE "_id" = $1`, [params.id]
  );
  if (/^PRB-/i.test(String(prb?.contrato || ''))) {
    throw new ValidationError('Es un contrato de prueba: no se puede aprobar.');
  }

  const ip =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';

  // 1. Save consent
  const result = await autoApproveConsent(
    params.id,
    session.user?.email || 'system@lgs.com',
    session.user?.name || 'System',
    ip,
    ua
  );

  // 2. Fetch contract data for audit + PDF
  const titular = await queryOne(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [params.id]
  );

  // 3. Write audit record
  await registrarAuditoriaAutoaprobacion({
    contrato: titular?.contrato || null,
    titularId: params.id,
    usuarioEmail: session.user?.email || 'system@lgs.com',
    usuarioNombre: session.user?.name || 'System',
    ip,
    userAgent: ua,
  });

  // 4. Generar PDF y archivar en Drive (best-effort — un fallo no rompe el consentimiento).
  //    Lógica compartida con el "Autoaprobar" del centro de aprobación.
  let driveUpload: any = null;
  let pdfUrl: string | null = null;
  try {
    const archive = await generateAndArchiveContractPdf(params.id, {
      hasConsent: true,
      consent: result.consent,
      hash: result.hash,
    });
    pdfUrl = archive.pdfUrl;
    driveUpload = archive.driveUpload;
  } catch (pdfErr: any) {
    console.warn('⚠️ [auto-approve] PDF/Drive upload failed (non-critical):', pdfErr.message);
  }

  return successResponse({
    message: 'Consentimiento automático registrado exitosamente',
    hash: result.hash,
    pdfUrl,
    driveUpload,
  });
});
