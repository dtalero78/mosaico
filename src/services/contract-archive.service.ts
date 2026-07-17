import 'server-only';
import { queryOne, queryMany } from '@/lib/postgres';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { buildContractHtml, buildContractPdfOptions, buildContractFileBase } from '@/lib/contract-pdf';
import { getAsesorInfo } from '@/lib/asesor';

/**
 * Genera el PDF del contrato y lo archiva. Extraído de
 * `api/consent/[id]/auto-approve/route.ts` para compartirlo con el "Autoaprobar"
 * del centro de aprobación (que también debe generar el contrato).
 *
 * Archiva vía **bsl-utilidades → carpeta de LGS** (`empresa: 'LGS'`), igual que
 * hoy send-pdf y auto-approve. NO usa el Drive propio a propósito: mientras
 * send-pdf siga en BSL, mover sólo este flujo a Drive repartiría los contratos en
 * dos carpetas (ver la nota "⚠ ANTES de cargar las credenciales de Drive" en
 * CLAUDE.md). Cuando se migren los tres a la vez, se cambia aquí en un solo sitio.
 */

const API2PDF_KEY = process.env.API2PDF_KEY || '9450b12a-4c5f-4e8e-a605-2b61fe4807f2';
const BSL_UPLOAD_URL = 'https://bsl-utilidades-yp78a.ondigitalocean.app/subir-pdf-directo';

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

  const driveUpload = await fetch(BSL_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdfUrl,
      // `documento` = nombre del archivo en Drive: MOS_<contrato> (mismo que
      // send-pdf y regenerate-drive).
      documento: buildContractFileBase(built.contrato, titularId),
      empresa: 'LGS', // pendiente: bsl-utilidades no tiene la empresa "MOSAICO" aún
    }),
  }).then(r => r.json()).catch(() => ({ error: 'Drive upload failed' }));

  return { ok: true, pdfUrl, driveUpload };
}
