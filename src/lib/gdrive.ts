import 'server-only';
import { Readable } from 'stream';
import { google } from 'googleapis';

/**
 * Subida de PDFs a Google Drive, propia de MOSAICO (reemplaza a `bsl-utilidades`,
 * el servicio de LGS que dejaba los contratos en la carpeta de LGS).
 *
 * Soporta DOS modos de autenticación:
 *
 * 1. OAuth de usuario (el que usamos). La app actúa COMO la cuenta dueña de la
 *    carpeta, así que los PDFs quedan a su nombre y contra SU cuota.
 *      GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
 *
 * 2. Cuenta de servicio (JWT). Sólo sirve si la carpeta vive en una UNIDAD
 *    COMPARTIDA (Google Workspace), donde los archivos pertenecen a la unidad.
 *      GOOGLE_SERVICE_ACCOUNT_JSON  (JSON crudo o base64 — la private_key se
 *                                    corrompe fácil al pegarla en un panel)
 *
 * Por qué NO usamos cuenta de servicio contra la carpeta actual: desde 2021 todo
 * archivo de Drive necesita un dueño con cuota, y una cuenta de servicio tiene 0
 * bytes. Al crear el archivo, éste le pertenecería a ella → Google rechaza la
 * subida con "Service Accounts do not have storage quota", aunque la carpeta esté
 * compartida como Editor. Con una carpeta en "Mi unidad" de un Gmail, la única
 * salida gratuita es actuar como el usuario (modo 1).
 *
 * En ambos modos: GDRIVE_CONTRATOS_FOLDER_ID → ID de la carpeta destino.
 */

// `drive` (no `drive.file`): la sobreescritura por nombre necesita VER el archivo
// existente aunque lo haya creado otro contexto (otro deploy/sesión/instancia).
// Con `drive.file` la cuenta sólo ve los archivos que ELLA creó en ESE contexto, así
// que al regenerar no encontraba el original y creaba un DUPLICADO (verificado:
// drive.file veía 1 de 2 copias; drive ve las 2). La cuenta de servicio sólo tiene
// acceso a la carpeta CONTRATOS MOS (es miembro), así que el scope amplio no expande
// su alcance real, y en una cuenta de servicio (JWT) no hay pantalla de consentimiento
// ni verificación de Google que penalice el scope.
const SCOPES = ['https://www.googleapis.com/auth/drive'];

/** ¿Hay credenciales de OAuth de usuario? */
function hasOAuth(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

export function isDriveConfigured(): boolean {
  if (!process.env.GDRIVE_CONTRATOS_FOLDER_ID) return false;
  return hasOAuth() || !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
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
  // OAuth de usuario primero: es el modo que funciona con una carpeta en "Mi
  // unidad". La cuenta de servicio queda como alternativa para Unidades
  // compartidas (Workspace), donde el dueño del archivo es la unidad.
  if (hasOAuth()) {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    // Con el refresh_token la librería renueva el access_token sola en cada
    // llamada; no hay que persistir nada más.
    auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
    return google.drive({ version: 'v3', auth });
  }

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
