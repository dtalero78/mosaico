import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { autoApproveConsent } from '@/services/consent.service';
import { generateAndArchiveContractPdf } from '@/services/contract-archive.service';
import { query, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

// One-time migration: ensure auditautoaprov table exists
let auditTableReady = false;
async function ensureAuditTable() {
  if (auditTableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS "auditautoaprov" (
      "_id"           VARCHAR(60) PRIMARY KEY,
      "contrato"      VARCHAR(50),
      "titularId"     VARCHAR(60),
      "usuarioEmail"  VARCHAR(200),
      "usuarioNombre" VARCHAR(200),
      "ip"            VARCHAR(100),
      "userAgent"     TEXT,
      "_createdDate"  TIMESTAMPTZ DEFAULT NOW()
    )`,
    []
  );
  auditTableReady = true;
}

export const POST = handlerWithAuth(async (request, { params }, session) => {
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
  await ensureAuditTable();
  await query(
    `INSERT INTO "auditautoaprov"
       ("_id", "contrato", "titularId", "usuarioEmail", "usuarioNombre", "ip", "userAgent", "_createdDate")
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      generateId('aud'),
      titular?.contrato || null,
      params.id,
      session.user?.email || 'system@lgs.com',
      session.user?.name || 'System',
      ip,
      ua,
    ]
  );

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
