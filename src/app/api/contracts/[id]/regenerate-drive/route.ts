import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { getAsesorInfo } from '@/lib/asesor';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { htmlToPdfBuffer } from '@/lib/pdf';
import { uploadPdfToDrive, isDriveConfigured } from '@/lib/gdrive';

/**
 * POST /api/contracts/[id]/regenerate-drive
 *
 * Regenera el PDF del contrato con Chromium propio (puppeteer-core) y lo sube al
 * Drive de MOSAICO con su cuenta de servicio, sobreescribiendo el anterior del
 * mismo titular. NO envía WhatsApp.
 *
 * Antes esto dependía de dos servicios de LGS (API2PDF para renderizar y
 * bsl-utilidades para subir, que además dejaba el PDF en la carpeta de LGS).
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

  const asesorInfo = await getAsesorInfo((titular as any).asesor, (titular as any).asesorMail);
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

  if (!isDriveConfigured()) {
    throw new ValidationError(
      'Google Drive no está configurado. Faltan GOOGLE_SERVICE_ACCOUNT_JSON y/o GDRIVE_CONTRATOS_FOLDER_ID.'
    );
  }

  // 1. Generar el PDF con Chromium propio (sin API2PDF)
  const pdf = await htmlToPdfBuffer(htmlContent);

  // 2. Subir al Drive de MOSAICO. El nombre lleva el número de contrato para que
  //    sea legible en la carpeta, y el titularId para que sea único y estable:
  //    regenerar sobreescribe en vez de duplicar.
  const filename = `${titular.contrato || 'SIN-CONTRATO'}_${titularId}.pdf`;
  const driveUpload = await uploadPdfToDrive(pdf, filename);

  return successResponse({
    driveUpload,
    pdfBytes: pdf.length,
    contrato: titular.contrato,
    titular: {
      _id: titular._id,
      primerNombre: titular.primerNombre,
      primerApellido: titular.primerApellido,
      numeroId: titular.numeroId,
    },
  });
});
