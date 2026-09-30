/**
 * Sube el video de bienvenida (pestaña Servicio › Welcome Session › Video Welcome)
 * a Spaces y lo deja como el vigente en APP_CONFIG `welcome_video`.
 *
 * Es la carga inicial: después se reemplaza desde la propia pestaña (permiso
 * SERVICIO.WELCOME.VIDEO_REEMPLAZAR). El objeto queda PRIVADO; la página pública
 * /video-welcome lo reproduce con una URL temporal.
 *
 * Uso: node scripts/subir-video-welcome.js --file=Videos/Acceso_plataforma_MOS.mp4 [--apply]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const arg = (process.argv.find((a) => a.startsWith('--file=')) || '').slice(7);
if (!arg) { console.error('Falta --file=ruta/al/video.mp4'); process.exit(1); }
const file = path.resolve(arg);
if (!fs.existsSync(file)) { console.error(`No existe: ${file}`); process.exit(1); }
if (!/\.mp4$/i.test(file)) { console.error('El video debe ser .mp4'); process.exit(1); }

const BUCKET = process.env.DO_SPACES_BUCKET;
const s3 = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT || 'https://sfo3.digitaloceanspaces.com',
  region: process.env.DO_SPACES_REGION || 'sfo3',
  credentials: { accessKeyId: process.env.DO_SPACES_KEY || '', secretAccessKey: process.env.DO_SPACES_SECRET || '' },
  forcePathStyle: false,
  // Mismo criterio que src/lib/spaces.ts fuera de producción.
  requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) }),
});
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const body = fs.readFileSync(file);
  const nombre = path.basename(file);
  const key = `videos/welcome/video-welcome-${Date.now()}.mp4`;
  const { rows } = await pool.query(`SELECT "value" FROM "APP_CONFIG" WHERE "key" = 'welcome_video'`);
  const anterior = rows[0]?.value ? JSON.parse(rows[0].value) : null;

  console.log(`  Archivo : ${nombre} (${(body.length / 1048576).toFixed(1)} MB)`);
  console.log(`  Destino : ${BUCKET}/${key}`);
  console.log(`  Vigente : ${anterior ? anterior.nombre + ' (' + anterior.key + ')' : '(ninguno)'}`);
  if (!APPLY) { console.log('\n  Ensayo. Correr con --apply para subirlo.\n'); await pool.end(); return; }

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'video/mp4', ACL: 'private' }));
  const cfg = { key, nombre, tamano: body.length, subidoPor: 'Carga inicial (script)', subidoEn: new Date().toISOString() };
  await pool.query(
    `INSERT INTO "APP_CONFIG" ("key","value","updatedBy","_updatedDate") VALUES ('welcome_video',$1,'script',NOW())
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedBy" = EXCLUDED."updatedBy", "_updatedDate" = NOW()`,
    [JSON.stringify(cfg)]
  );
  if (anterior?.key && anterior.key !== key) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: anterior.key })).catch(() => {});
  }
  console.log('\n✓ Video subido y vigente.\n');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
