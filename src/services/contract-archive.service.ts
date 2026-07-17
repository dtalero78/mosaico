import 'server-only';
import { queryOne, queryMany } from '@/lib/postgres';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { buildContractHtml, buildContractPdfOptions, buildContractFileBase } from '@/lib/contract-pdf';
import { getAsesorInfo } from '@/lib/asesor';
import { isDriveConfigured, uploadPdfToDrive } from '@/lib/gdrive';

/**
 * Genera el PDF del contrato y lo archiva. Extraído de
 * `api/consent/[id]/auto-approve/route.ts` para compartirlo con el "Autoaprobar"
 * del centro de aprobación y con `send-pdf`.
 *
 * **Destino único (Drive propio o BSL) decidido en `archiveContractPdfFromUrl`**:
 * si `isDriveConfigured()` sube a la Unidad compartida propia (carpeta CONTRATOS
 * MOS); si no, cae a bsl-utilidades → carpeta de LGS (`empresa: 'LGS'`). Como los
 * tres flujos por-URL usan este helper, todos migran a Drive a la vez al cargar
 * las credenciales — nunca quedan repartidos en dos carpetas.
 */

const API2PDF_KEY = process.env.API2PDF_KEY || '9450b12a-4c5f-4e8e-a605-2b61fe4807f2';
const BSL_UPLOAD_URL = 'https://bsl-utilidades-yp78a.ondigitalocean.app/subir-pdf-directo';

/**
 * Archiva un PDF ya generado (dado por su URL de API2PDF) en el destino vigente.
 * Sólo descarga los bytes cuando hay Drive configurado (para no gastar ancho de
 * banda cuando aún se usa BSL, que sólo necesita la URL). `filenameBase` =
 * MOS_<contrato> (mismo nombre en los tres flujos).
 */
export async function archiveContractPdfFromUrl(
  pdfUrl: string,
  filenameBase: string
): Promise<{ via: 'drive' | 'bsl'; driveUpload: any; webViewLink: string | null }> {
  if (isDriveConfigured()) {
    const res = await fetch(pdfUrl);
    if (!res.ok) throw new Error(`descarga del PDF falló: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const up = await uploadPdfToDrive(bytes, `${filenameBase}.pdf`);
    return { via: 'drive', driveUpload: up, webViewLink: up.webViewLink };
  }
  // BSL sólo acepta una URL (no bytes) → le pasamos la de API2PDF directamente.
  const driveUpload = await fetch(BSL_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfUrl, documento: filenameBase, empresa: 'LGS' }),
  }).then(r => r.json()).catch(() => ({ error: 'Drive upload failed' }));
  return { via: 'bsl', driveUpload, webViewLink: null };
}

export interface ConsentBlock {
  hasConsent: boolean;
  consent: any;
  hash: string;
}

export interface ContractArchiveResult {
  ok: boolean;
  reason?: string;      // por qué no se archivó (sin plataforma, sin plantilla, etc.)
  pdfUrl: string | null;
  driveUpload: any;
}

/**
 * Arma el HTML del contrato (datos + plantilla + membrete). SIN llamadas de red —
 * testeable de forma aislada. Devuelve null si faltan datos para renderizarlo.
 */
export async function buildContractHtmlForTitular(
  titularId: string,
  consent?: ConsentBlock | null
): Promise<{ html: string; contrato: string } | { html: null; reason: string }> {
  const titular = await queryOne(`SELECT * FROM "PEOPLE" WHERE "_id" = $1`, [titularId]);
  if (!titular) return { html: null, reason: 'titular no encontrado' };
  if (!titular.plataforma || !titular.contrato) {
    return { html: null, reason: 'sin plataforma o sin número de contrato' };
  }

  const beneficiarios = await queryMany(
    `SELECT * FROM "PEOPLE" WHERE "contrato" = $1 AND "_id" != $2 ORDER BY "_createdDate" ASC`,
    [titular.contrato, titularId]
  );

  // FINANCIEROS por "contrato" (la columna titularId legacy quedó NULL en la migración).
  const financial = await queryOne(
    `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`,
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
  if (!templateRow?.template) return { html: null, reason: 'sin plantilla para la plataforma' };

  // Bloque de consentimiento: el pasado por parámetro, o el ya guardado en PEOPLE.
  let consentData: ConsentBlock | undefined;
  if (consent) {
    consentData = consent;
  } else if (titular.hashConsentimiento) {
    const stored = typeof titular.consentimientoDeclarativo === 'string'
      ? (() => { try { return JSON.parse(titular.consentimientoDeclarativo); } catch { return null; } })()
      : titular.consentimientoDeclarativo;
    consentData = { hasConsent: true, consent: stored, hash: titular.hashConsentimiento };
  }

  const asesorInfo = await getAsesorInfo((titular as any).asesor, (titular as any).asesorMail);
  const contractText = fillContractTemplate(
    templateRow.template,
    titular,
    beneficiarios,
    financial,
    consentData as any,
    asesorInfo,
  );

  return { html: buildContractHtml(contractText, titular.contrato), contrato: titular.contrato };
}

/**
 * Genera el PDF (API2PDF) y lo sube a Drive vía bsl-utilidades. Best-effort:
 * el llamador decide si un fallo aquí debe o no romper su flujo. `filenameBase`
 * = MOS_<contrato> (mismo nombre para los tres flujos).
 */
export async function generateAndArchiveContractPdf(
  titularId: string,
  consent?: ConsentBlock | null
): Promise<ContractArchiveResult> {
  const built = await buildContractHtmlForTitular(titularId, consent);
  if (built.html === null) {
    return { ok: false, reason: built.reason, pdfUrl: null, driveUpload: null };
  }

  const pdfRes = await fetch('https://v2018.api2pdf.com/chrome/html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': API2PDF_KEY },
    body: JSON.stringify({ html: built.html, options: buildContractPdfOptions(built.contrato) }),
  });
  if (!pdfRes.ok) return { ok: false, reason: `API2PDF ${pdfRes.status}`, pdfUrl: null, driveUpload: null };

  const pdfData = await pdfRes.json();
  if (!pdfData.success || !pdfData.pdf) {
    return { ok: false, reason: 'API2PDF sin PDF', pdfUrl: null, driveUpload: null };
  }
  const pdfUrl: string = pdfData.pdf;

  // Destino (Drive propio o BSL) resuelto en un solo sitio, MOS_<contrato>.
  const archived = await archiveContractPdfFromUrl(pdfUrl, buildContractFileBase(built.contrato, titularId));

  return { ok: true, pdfUrl, driveUpload: archived.driveUpload };
}
