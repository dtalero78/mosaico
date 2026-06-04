import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { getAsesorInfo } from '@/lib/asesor';

const API2PDF_KEY = process.env.API2PDF_KEY || '9450b12a-4c5f-4e8e-a605-2b61fe4807f2';
const WHAPI_TOKEN = 'VSyDX4j7ooAJ7UGOhz8lGplUVDDs2EYj';
const BSL_UPLOAD_URL = 'https://bsl-utilidades-yp78a.ondigitalocean.app/subir-pdf-directo';

export const POST = handler(async (_request, { params }) => {
  const titularId = params.id;

  // 1. Load full contract data
  const titular = await queryOne(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);
  if (!titular.celular) throw new ValidationError('El titular no tiene celular registrado');
  if (!titular.plataforma) throw new ValidationError('El titular no tiene plataforma asignada');

  // Beneficiarios = all PEOPLE with same contrato number, excluding the titular
  const beneficiarios = await queryMany(
    `SELECT * FROM "PEOPLE" WHERE "contrato" = $1 AND "_id" != $2 ORDER BY "_createdDate" ASC`,
    [titular.contrato, titularId]
  );

  // FINANCIEROS se busca por "contrato" (la tabla no tiene titularId / éste columna
  // legacy quedó NULL en la migración). Mismo patrón que el endpoint público
  // /api/consent/[id]/contract-data — antes este endpoint usaba titularId y por eso
  // los placeholders financieros del PDF (totalPlan/valorCuota/saldo/...) salían vacíos.
  const financial = titular.contrato
    ? await queryOne(
        `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1
         ORDER BY "_createdDate" DESC LIMIT 1`,
        [titular.contrato]
      )
    : null;

  // 2. Fetch contract template for this platform
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
  if (!templateRow?.template) throw new NotFoundError('ContractTemplate', titular.plataforma);

  // 3. Build consent data if available
  const consentRaw = titular.consentimientoDeclarativo;
  const consentObj = typeof consentRaw === 'string' ? JSON.parse(consentRaw) : consentRaw;
  const consentData = consentObj?.aceptado || consentObj?.declaracionAceptada
    ? { hasConsent: true, consent: consentObj, hash: titular.hashConsentimiento }
    : { hasConsent: false };

  // 3b. Resolve ejecutivo comercial (asesor) — incluido al final del bloque de consentimiento.
  const asesorInfo = await getAsesorInfo((titular as any).asesor);

  // 4. Fill template with data (full contract text)
  const contractText = fillContractTemplate(
    templateRow.template,
    titular,
    beneficiarios,
    financial,
    consentData,
    asesorInfo,
  );

  // 5. Wrap in HTML for PDF generation
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

  // 6. Generate PDF with API2PDF (HTML mode — no URL dependency)
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

  // 7. Upload PDF to Drive via bsl-utilidades in parallel with WhatsApp send
  const uploadPromise = fetch(BSL_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfUrl: tempPdfUrl, documento: titularId, empresa: 'LGS' }),
  }).then(r => r.json()).catch(() => ({}));

  // 8. Send PDF via Whapi using the API2PDF direct URL (clean S3 link, no redirects)
  const phone = titular.celular.toString().replace(/\D/g, '');
  // Filename: primerNombre + primerApellido + numeroId
  const nameParts = [titular.primerNombre, titular.primerApellido, titular.numeroId].filter(Boolean);
  const filename = nameParts.length > 0
    ? `${nameParts.join(' ')}.pdf`
    : `Contrato-LGS.pdf`;

  const whapiRes = await fetch('https://gate.whapi.cloud/messages/document', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${WHAPI_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: phone,
      media: tempPdfUrl,
      filename,
      caption: `Hola ${titular.primerNombre || ''}, adjunto encontrarás tu contrato con LetsGoSpeak. 📄`,
    }),
  });

  const uploadData = await uploadPromise;

  if (!whapiRes.ok) {
    const err = await whapiRes.text();
    throw new Error(`Whapi error ${whapiRes.status}: ${err}`);
  }

  const whapiData = await whapiRes.json();

  return successResponse({
    pdfUrl: tempPdfUrl,
    driveUpload: uploadData,
    whatsapp: whapiData,
    sentTo: phone,
  });
});
