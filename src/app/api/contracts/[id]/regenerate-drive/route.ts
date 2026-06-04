import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { getAsesorInfo } from '@/lib/asesor';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';

const API2PDF_KEY = process.env.API2PDF_KEY || '9450b12a-4c5f-4e8e-a605-2b61fe4807f2';
const BSL_UPLOAD_URL = 'https://bsl-utilidades-yp78a.ondigitalocean.app/subir-pdf-directo';

/**
 * POST /api/contracts/[id]/regenerate-drive
 *
 * Regenera el PDF del contrato (mismo flujo que /send-pdf — API2PDF) y lo
 * sube al Drive vía bsl-utilidades, sobreescribiendo el PDF anterior por
 * el mismo `documento: titularId`. NO envía WhatsApp.
 *
 * Útil para casos donde se detecta un error en un contrato ya entregado:
 *   - bug que dejó valores financieros vacíos
 *   - corrección de datos del titular tras envío
 *   - ajuste de template
 *
 * Acceso: roles con `MANTENIMIENTO.USUARIOS.GENERAR_CONTRATO` o
 *         SUPER_ADMIN / ADMIN (bypass).
 */
export const POST = handlerWithAuth(async (_request, { params }, session) => {
  await requirePermission(session, MantenimientoPermission.GENERAR_CONTRATO);

  const titularId = params.id;

  const titular = await queryOne<any>(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);
  if (!titular.plataforma) throw new ValidationError('El titular no tiene plataforma asignada');

  const beneficiarios = await queryMany<any>(
    `SELECT * FROM "PEOPLE" WHERE "contrato" = $1 AND "_id" != $2 ORDER BY "_createdDate" ASC`,
    [titular.contrato, titularId]
  );

  // FINANCIEROS por contrato (NO titularId — la columna está NULL en la migración)
  const financial = titular.contrato
    ? await queryOne<any>(
        `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1
         ORDER BY "_createdDate" DESC LIMIT 1`,
        [titular.contrato]
      )
    : null;

  // Template del contrato por plataforma (con fallback case-insensitive)
  let templateRow = await queryOne<{ template: string }>(
    `SELECT "template" FROM "ContractTemplates" WHERE "plataforma" = $1`,
    [titular.plataforma]
  );
  if (!templateRow) {
    templateRow = await queryOne<{ template: string }>(
      `SELECT "template" FROM "ContractTemplates" WHERE LOWER("plataforma") = LOWER($1)`,
      [titular.plataforma]
    );
  }
  if (!templateRow?.template) throw new NotFoundError('ContractTemplate', titular.plataforma);

  // Datos de consentimiento (si existen)
  const consentRaw = titular.consentimientoDeclarativo;
  const consentObj = typeof consentRaw === 'string' ? JSON.parse(consentRaw) : consentRaw;
  const consentData = consentObj?.aceptado || consentObj?.declaracionAceptada
    ? { hasConsent: true, consent: consentObj, hash: titular.hashConsentimiento }
    : { hasConsent: false };

  const asesorInfo = await getAsesorInfo((titular as any).asesor);
  const contractText = fillContractTemplate(
    templateRow.template,
    titular,
    beneficiarios,
    financial,
    consentData,
    asesorInfo,
  );

  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contrato ${titular.contrato || ''}</title>
  <style>
    @page { margin: 15mm 15mm 15mm 20mm; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10.5pt;
      line-height: 1.5;
      color: #111;
      margin: 0;
      padding: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>${contractText}</body>
</html>`;

  // 1. Generar PDF con API2PDF
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
  if (!pdfRes.ok) {
    const err = await pdfRes.text();
    throw new Error(`API2PDF error ${pdfRes.status}: ${err}`);
  }
  const pdfData = await pdfRes.json();
  if (!pdfData.success || !pdfData.pdf) {
    throw new Error(`API2PDF falló: ${pdfData.error || 'Sin URL de PDF'}`);
  }
  const tempPdfUrl: string = pdfData.pdf;

  // 2. Subir al Drive vía bsl-utilidades (sobreescribe por documento=titularId)
  const uploadRes = await fetch(BSL_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfUrl: tempPdfUrl, documento: titularId, empresa: 'LGS' }),
  });
  const driveUpload = await uploadRes.json().catch(() => ({}));

  return successResponse({
    pdfUrl: tempPdfUrl,
    driveUpload,
    contrato: titular.contrato,
    titular: {
      _id: titular._id,
      primerNombre: titular.primerNombre,
      primerApellido: titular.primerApellido,
      numeroId: titular.numeroId,
    },
  });
});
