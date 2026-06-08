/**
 * upload-libro-interactivo.js
 *
 * Convierte un PDF de libro completo a imágenes JPG (una por página) y las
 * sube a DO Spaces bajo `materials/interactive/{codigo}/page-NNN.jpg`. Tras
 * subir, actualiza `LIBROS_INTERACTIVOS.totalPaginas` con el número final.
 *
 * Uso:
 *   node scripts/upload-libro-interactivo.js \
 *     --codigo=BEGINNER \
 *     --pdf=./Beginner.pdf \
 *     [--titulo="Beginner — Let's Go Speak 2024"] \
 *     [--dpi=150] \
 *     [--apply]
 *
 * Dry-run por defecto (solo cuenta páginas + reporta). Con --apply convierte,
 * sube a Spaces y actualiza BD.
 *
 * Requisitos:
 *   - Variable de entorno DATABASE_URL + DO_SPACES_* en .env.local
 *   - Binario `pdftoppm` (poppler-utils) en PATH
 *       macOS:  brew install poppler
 *       Ubuntu: sudo apt install poppler-utils
 *       Windows: descargar poppler para Windows y agregar a PATH
 *               https://github.com/oschwartz10612/poppler-windows/releases
 *
 * Idempotente: re-ejecutar reemplaza las imágenes en Spaces y actualiza el
 * conteo. Los audios y bindings de niveles NO se tocan.
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ── CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2).reduce((acc, arg) => {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) acc[m[1]] = m[2] ?? true;
  return acc;
}, {});

const CODIGO = String(args.codigo || '').toUpperCase().trim();
const PDF_PATH = args.pdf ? path.resolve(String(args.pdf)) : null;
const TITULO_FLAG = args.titulo ? String(args.titulo) : null;
const DPI = Number(args.dpi) || 150;
const APPLY = !!args.apply;

if (!CODIGO || !PDF_PATH) {
  console.error('Uso: node scripts/upload-libro-interactivo.js --codigo=BEGINNER --pdf=./libro.pdf [--titulo="..."] [--dpi=150] [--apply]');
  process.exit(1);
}
if (!fs.existsSync(PDF_PATH)) {
  console.error(`❌ No existe el archivo: ${PDF_PATH}`);
  process.exit(1);
}

const DB_URL = process.env.DATABASE_URL;
const S3_ENDPOINT = process.env.DO_SPACES_ENDPOINT || 'https://sfo3.digitaloceanspaces.com';
const S3_REGION = process.env.DO_SPACES_REGION || 'sfo3';
const S3_BUCKET = process.env.DO_SPACES_BUCKET || 'lgs-bucket';
const S3_KEY = process.env.DO_SPACES_KEY;
const S3_SECRET = process.env.DO_SPACES_SECRET;

if (!DB_URL || !S3_KEY || !S3_SECRET) {
  console.error('❌ Faltan variables de entorno (DATABASE_URL / DO_SPACES_KEY / DO_SPACES_SECRET)');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

async function checkPdftoppm() {
  try {
    await run('pdftoppm', ['-v']);
  } catch (e) {
    // pdftoppm imprime versión en stderr y exit 0 a veces, así que el catch
    // probablemente significa que NO está instalado
    const stderr = (e.message || '').toLowerCase();
    if (stderr.includes('enoent') || stderr.includes('not found')) {
      console.error('\n❌ pdftoppm no está instalado. Instalación:');
      console.error('   macOS:   brew install poppler');
      console.error('   Ubuntu:  sudo apt install poppler-utils');
      console.error('   Windows: https://github.com/oschwartz10612/poppler-windows/releases\n');
      process.exit(1);
    }
    // Otros errores los ignoramos — el binario existe.
  }
}

// ── Main ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n📚 Libro interactivo: ${CODIGO}`);
  console.log(`   PDF:  ${PDF_PATH}`);
  console.log(`   DPI:  ${DPI}`);
  console.log(`   Modo: ${APPLY ? '🔴 APPLY' : '🟡 DRY-RUN'}\n`);

  await checkPdftoppm();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `libro-${CODIGO}-`));
  console.log(`📂 Trabajando en ${tmpDir}\n`);

  try {
    // 1) Convertir PDF → JPGs
    console.log('1) Convirtiendo PDF a imágenes JPG…');
    const prefix = path.join(tmpDir, 'page');
    await run('pdftoppm', [
      '-jpeg',
      '-r', String(DPI),
      '-jpegopt', 'quality=85',
      PDF_PATH,
      prefix,
    ]);

    // Renombra page-1.jpg, page-2.jpg → page-001.jpg, page-002.jpg
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).sort();
    const renamed = [];
    for (const f of files) {
      const m = f.match(/page-(\d+)\.jpg$/);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      const newName = `page-${String(n).padStart(3, '0')}.jpg`;
      if (newName !== f) {
        fs.renameSync(path.join(tmpDir, f), path.join(tmpDir, newName));
      }
      renamed.push({ n, file: newName, fullPath: path.join(tmpDir, newName) });
    }
    renamed.sort((a, b) => a.n - b.n);
    const totalPaginas = renamed.length;
    console.log(`   ✅ ${totalPaginas} páginas generadas\n`);

    if (totalPaginas === 0) {
      throw new Error('pdftoppm no generó ninguna imagen');
    }

    if (!APPLY) {
      console.log('🟡 DRY-RUN: no se subió a Spaces ni se tocó BD.');
      console.log(`   En modo --apply se subirá ${totalPaginas} JPGs a:`);
      console.log(`   materials/interactive/${CODIGO}/page-001.jpg ... page-${String(totalPaginas).padStart(3, '0')}.jpg`);
      console.log(`   Y se hará UPSERT en LIBROS_INTERACTIVOS con totalPaginas=${totalPaginas}.\n`);
      return;
    }

    // 2) S3 client
    const s3 = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
      forcePathStyle: false,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }),
    });

    // 3) Subir cada página
    console.log(`2) Subiendo ${totalPaginas} JPGs a Spaces…`);
    const prefixS3 = `materials/interactive/${CODIGO}/`;
    let uploaded = 0;
    for (const p of renamed) {
      const body = fs.readFileSync(p.fullPath);
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: prefixS3 + p.file,
        Body: body,
        ContentType: 'image/jpeg',
        ACL: 'private',
        CacheControl: 'private, max-age=86400',
      }));
      uploaded++;
      if (uploaded % 10 === 0 || uploaded === totalPaginas) {
        process.stdout.write(`\r   ${uploaded}/${totalPaginas}`);
      }
    }
    console.log('\n   ✅ Upload completo\n');

    // 4) UPSERT en BD
    console.log('3) Actualizando BD…');
    const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    try {
      const existing = await pool.query(
        `SELECT "titulo" FROM "LIBROS_INTERACTIVOS" WHERE "codigo" = $1`,
        [CODIGO]
      );
      const tituloFinal = TITULO_FLAG || existing.rows[0]?.titulo || CODIGO;
      await pool.query(
        `INSERT INTO "LIBROS_INTERACTIVOS" ("codigo", "titulo", "totalPaginas")
              VALUES ($1, $2, $3)
         ON CONFLICT ("codigo") DO UPDATE SET
           "titulo"       = EXCLUDED."titulo",
           "totalPaginas" = EXCLUDED."totalPaginas",
           "_updatedDate" = NOW()`,
        [CODIGO, tituloFinal, totalPaginas]
      );
      console.log(`   ✅ LIBROS_INTERACTIVOS actualizado (totalPaginas=${totalPaginas})\n`);
    } finally {
      await pool.end();
    }

    console.log('🎉 Listo. Próximos pasos:');
    console.log('   1. Configura los rangos por nivel en /admin/actualizar-material/interactivo');
    console.log('   2. Sube los audios desde la misma página (drop MP3 con número de página)');
    console.log('   3. Activa el feature flag desde el admin para que aparezca el botón en el panel estudiante\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    // Limpieza tmpDir
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch {}
  }
})();
