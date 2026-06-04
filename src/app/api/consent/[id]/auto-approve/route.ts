import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { autoApproveConsent } from '@/services/consent.service';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { getAsesorInfo } from '@/lib/asesor';

const API2PDF_KEY = process.env.API2PDF_KEY || '9450b12a-4c5f-4e8e-a605-2b61fe4807f2';
const BSL_UPLOAD_URL = 'https://bsl-utilidades-yp78a.ondigitalocean.app/subir-pdf-directo';

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

  // 4. Generate PDF and upload to Drive (non-blocking — errors don't fail the consent)
  let driveUpload: any = null;
  let pdfUrl: string | null = null;

  try {
    if (titular?.plataforma && titular?.contrato) {
      const beneficiarios = await queryMany(
        `SELECT * FROM "PEOPLE" WHERE "contrato" = $1 AND "_id" != $2 ORDER BY "_createdDate" ASC`,
        [titular.contrato, params.id]
      );

      // FINANCIEROS se busca por "contrato" (mismo bug que send-pdf — la tabla no
      // tiene titularId / esa columna legacy quedó NULL en la migración).
      const financial = await queryOne(
        `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1
         ORDER BY "_createdDate" DESC LIMIT 1`,
        [titular.contrato]
      );

      let templateRow = await queryOne(
        `SELECT "template" FROM "ContractTemplates" WHERE "plataforma" = $1`,
        [titular.plataforma]
      );
      if (!templateRow) {
        templateRow = await queryOne(
          `SELECT "template" FROM "ContractTemplates" WHERE LOWER("plataforma") = LOWER($1)`,
          [titular.plataforma]
        );
      }

      if (templateRow?.template) {
        const consentData = {
          hasConsent: true,
          consent: result.consent,
          hash: result.hash,
        };

        const asesorInfo = await getAsesorInfo((titular as any).asesor);
        const contractText = fillContractTemplate(
          templateRow.template,
          titular,
          beneficiarios,
          financial,
          consentData as any,
          asesorInfo,
        );

        const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contrato ${titular.contrato}</title>
  <style>
    @page { margin: 15mm 15mm 15mm 20mm; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10.5pt;
      line-height: 1.5;
      color: #111;
      margin: 0; padding: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>${contractText}</body>
</html>`;

        const pdfRes = await fetch('https://v2018.api2pdf.com/chrome/html', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': API2PDF_KEY,
          },
          body: JSON.stringify({
            html: htmlContent,
            options: { printBackground: true },
          }),
        });

        if (pdfRes.ok) {
          const pdfData = await pdfRes.json();
          if (pdfData.success && pdfData.pdf) {
            pdfUrl = pdfData.pdf;

            // Upload to Drive — no WhatsApp
            driveUpload = await fetch(BSL_UPLOAD_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pdfUrl,
                documento: params.id,
                empresa: 'LGS',
              }),
            }).then(r => r.json()).catch(() => ({ error: 'Drive upload failed' }));
          }
        }
      }
    }
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
