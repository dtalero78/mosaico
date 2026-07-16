import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';
import { fillContractTemplate } from '@/lib/contract-template-filler';
import { getAsesorInfo } from '@/lib/asesor';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { htmlToPdfBuffer } from '@/lib/pdf';
import { buildContractHtml, buildContractPdfOptions } from '@/lib/contract-pdf';
import { uploadPdfToDrive, isDriveConfigured } from '@/lib/gdrive';
import { putBuffer, deleteObject, getPresignedGetUrl } from '@/lib/spaces';

const BSL_UPLOAD_URL = 'https://bsl-utilidades-yp78a.ondigitalocean.app/subir-pdf-directo';

/**
 * POST /api/contracts/[id]/regenerate-drive
 *
 * Regenera el PDF del contrato con Chromium propio (puppeteer-core) y lo sube a
 * Drive. NO envía WhatsApp.
 *
 * Destino del PDF — hay dos rutas y se elige sola:
 *   1. Drive PROPIO de MOSAICO (carpeta CONTRATOS MOS), si está configurado
 *      (OAuth de la cuenta dueña + GDRIVE_CONTRATOS_FOLDER_ID). Es el destino
 *      definitivo: sube los bytes directo, sin terceros.
 *   2. PUENTE TEMPORAL vía bsl-utilidades → carpeta de LGS, mientras se resuelve
 *      el acceso a CONTRATOS MOS. bsl-utilidades es un servicio de LGS que pide
 *      una URL del PDF (no acepta bytes), así que el PDF se deja unos minutos en
 *      el bucket propio de MOSAICO con una URL firmada, y se borra después.
 *      Va con empresa='LGS' porque bsl-utilidades NO tiene dada de alta la
 *      empresa "MOSAICO" (responde "No se encontró configuración para la empresa
 *      MOSAICO"), igual que send-pdf y auto-approve hoy.
 *
 * PENDIENTE: al terminar el OAuth, la ruta 1 se activa sola y este puente
 * (BSL + el paso por Spaces) se puede borrar.
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

  // HTML y presentación (membrete con logo + "Página X de Y") compartidos con
  // send-pdf y auto-approve, para que los tres PDFs salgan idénticos.
  const htmlContent = buildContractHtml(contractText, titular.contrato);

  // 1. Generar el PDF con Chromium propio (sin API2PDF)
  const pdf = await htmlToPdfBuffer(htmlContent, buildContractPdfOptions(titular.contrato));

  // Nombre del archivo: MOS_<contrato>.pdf. El nº de contrato es único por titular,
  // así que regenerar SOBREESCRIBE en vez de duplicar. Sin nº de contrato se cae al
  // id del titular para no colisionar.
  const baseName = titular.contrato
    ? `MOS_${titular.contrato}`
    : `MOS_SIN-CONTRATO_${titularId}`;

  // 2a. Destino definitivo: Drive propio de MOSAICO (cuando esté configurado).
  if (isDriveConfigured()) {
    const driveUpload = await uploadPdfToDrive(pdf, `${baseName}.pdf`);
    return successResponse({
      destino: 'DRIVE_MOSAICO',
      driveUpload,
      pdfBytes: pdf.length,
      contrato: titular.contrato,
      titular: {
        _id: titular._id, primerNombre: titular.primerNombre,
        primerApellido: titular.primerApellido, numeroId: titular.numeroId,
      },
    });
  }

  // 2b. Puente temporal: bsl-utilidades sólo acepta una URL, así que el PDF pasa
  //     unos minutos por el bucket propio con una URL firmada. `documento` es lo
  //     que bsl-utilidades usa para NOMBRAR el archivo en Drive (y como clave de
  //     sobreescritura), por eso se le manda el nombre completo.
  const tmpKey = `contratos-tmp/${baseName}-${Date.now()}.pdf`;
  let driveUpload: any;
  try {
    await putBuffer(tmpKey, pdf, 'application/pdf');
    const pdfUrl = await getPresignedGetUrl(tmpKey, 600); // 10 min: sólo para que BSL lo descargue

    const uploadRes = await fetch(BSL_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl, documento: baseName, empresa: 'LGS' }),
    });
    driveUpload = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || driveUpload?.error) {
      throw new Error(`bsl-utilidades: ${driveUpload?.error || uploadRes.status}`);
    }
  } finally {
    // El PDF ya está en Drive; el temporal no debe quedarse en el bucket.
    await deleteObject(tmpKey).catch(() => {});
  }

  return successResponse({
    destino: 'DRIVE_LGS_TEMPORAL',
    aviso: 'Subido a la carpeta de LGS vía bsl-utilidades (puente temporal). Pendiente: mover el proceso a la carpeta CONTRATOS MOS con el Drive propio.',
    archivo: `${baseName}.pdf`,
    driveUpload,
    pdfBytes: pdf.length,
    contrato: titular.contrato,
    titular: {
      _id: titular._id, primerNombre: titular.primerNombre,
      primerApellido: titular.primerApellido, numeroId: titular.numeroId,
    },
  });
});
