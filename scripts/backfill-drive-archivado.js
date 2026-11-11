/**
 * Marca PEOPLE."driveArchivadoEn" de los titulares cuyo PDF (MOS_<contrato>.pdf) YA está en la
 * carpeta CONTRATOS MOS. Lista la carpeta una sola vez (paginada). Ensayo por defecto; --apply escribe.
 * Requiere GOOGLE_SERVICE_ACCOUNT_JSON y GDRIVE_CONTRATOS_FOLDER_ID (.env.local).
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { google } = require('googleapis');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?]sslmode=[a-z-]+/, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const apply = process.argv.includes('--apply');
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  const creds = JSON.parse(raw);
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth });
  const parent = process.env.GDRIVE_CONTRATOS_FOLDER_ID;
  const archivos = new Map(); // contrato -> modifiedTime
  let pageToken;
  do {
    const r = await drive.files.list({
      q: `'${parent}' in parents and trashed = false`, fields: 'nextPageToken, files(name, modifiedTime)',
      pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    for (const f of r.data.files || []) { const m = /^MOS_(.+)\.pdf$/.exec(f.name || ''); if (m) archivos.set(m[1], f.modifiedTime); }
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  console.log('PDF MOS_* en la carpeta:', archivos.size);
  const t = await pool.query(`SELECT "_id","contrato","driveArchivadoEn" FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND COALESCE("contrato",'')<>'' AND "contrato" NOT LIKE 'PRB-%'`);
  let marcar = 0, sin = 0;
  for (const p of t.rows) {
    const mt = archivos.get(p.contrato);
    if (!mt) { sin++; continue; }
    if (p.driveArchivadoEn) continue;
    marcar++;
    if (apply) await pool.query(`UPDATE "PEOPLE" SET "driveArchivadoEn"=$1 WHERE "_id"=$2`, [mt, p._id]);
  }
  console.log(`Titulares: ${t.rows.length} · con PDF en Drive por marcar: ${marcar} · sin PDF en Drive: ${sin}${apply ? '' : '  (ensayo)'}`);
  await pool.end();
})();
