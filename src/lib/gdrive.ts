import 'server-only';
import { Readable } from 'stream';
import { google } from 'googleapis';

/**
 * Subida de PDFs a Google Drive con cuenta de servicio PROPIA de MOSAICO.
 *
 * Reemplaza la dependencia de `bsl-utilidades` (servicio de LGS que subía a la
 * carpeta de LGS). Aquí MOSAICO habla directo con la API de Drive.
 *
 * Configuración (env vars en DO):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  → el JSON de la cuenta de servicio. Se acepta
 *                                  crudo o en base64 (recomendado: el JSON tiene
 *                                  saltos de línea en la private_key que se
 *                                  corrompen fácil al pegarlos en un panel).
 *   GDRIVE_CONTRATOS_FOLDER_ID   → ID de la carpeta destino.
 *
 * La carpeta debe estar COMPARTIDA (rol Editor) con el email de la cuenta de
 * servicio (client_email del JSON). Sin eso, Drive responde 404 en la carpeta.
 */

const SCOPES = ['https://www.googleapis.com/auth/drive'];

export function isDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GDRIVE_CONTRATOS_FOLDER_ID);
}

function loadCredentials(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON');

  let text = raw.trim();
  // Acepta base64 (no empieza por '{') para sobrevivir al pegado en paneles.
  if (!text.startsWith('{')) {
    text = Buffer.from(text, 'base64').toString('utf8');
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido (ni base64 de uno)');
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('El JSON de la cuenta de servicio no tiene client_email / private_key');
  }
  // Si la private_key viaja con "\n" escapados, restaurarlos.
  json.private_key = String(json.private_key).replace(/\\n/g, '\n');
  return json;
}

function driveClient() {
  const creds = loadCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  return google.drive({ version: 'v3', auth });
}

export interface DriveUploadResult {
  fileId: string;
  name: string;
  webViewLink: string | null;
  updated: boolean; // true = sobreescribió uno existente
}

/**
 * Sube (o SOBREESCRIBE) un PDF en la carpeta de contratos.
 *
 * Sobreescribe por NOMBRE: si ya existe un archivo con ese nombre en la carpeta,
 * actualiza su contenido en vez de crear un duplicado — así regenerar el contrato
 * de un titular no llena el Drive de copias. Es el mismo criterio que usaba
 * bsl-utilidades con `documento: titularId`.
 */
export async function uploadPdfToDrive(
  pdf: Buffer,
  filename: string,
  folderId?: string
): Promise<DriveUploadResult> {
  const drive = driveClient();
  const parent = folderId || process.env.GDRIVE_CONTRATOS_FOLDER_ID;
  if (!parent) throw new Error('Falta GDRIVE_CONTRATOS_FOLDER_ID');

  const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  // Escapar comillas simples: romperían la query de Drive.
  const safeName = name.replace(/'/g, "\\'");

  const existing = await drive.files.list({
    q: `name = '${safeName}' and '${parent}' in parents and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const media = { mimeType: 'application/pdf', body: Readable.from(pdf) };
  const found = existing.data.files?.[0];

  if (found?.id) {
    const res = await drive.files.update({
      fileId: found.id,
      media,
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    });
    return {
      fileId: res.data.id!,
      name: res.data.name || name,
      webViewLink: res.data.webViewLink || null,
      updated: true,
    };
  }

  const res = await drive.files.create({
    requestBody: { name, parents: [parent], mimeType: 'application/pdf' },
    media,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return {
    fileId: res.data.id!,
    name: res.data.name || name,
    webViewLink: res.data.webViewLink || null,
    updated: false,
  };
}
