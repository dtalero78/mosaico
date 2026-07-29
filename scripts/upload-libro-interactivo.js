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
 *     [--rotar=7:cw,9:cw,10:ccw] \
 *     [--apply]
 *
 * Dry-run por defecto (solo cuenta páginas + reporta). Con --apply convierte,
 * sube a Spaces y actualiza BD.
 *
 * --rotar: páginas apaisadas que en el PDF quedaron giradas (contenido de lado).
 *   Se rotan tras convertir y antes de subir, para que queden derechas de forma
 *   PERMANENTE aunque se re-suba el PDF. Formato N:cw|ccw|180 (cw=90° horario,
 *   ccw=90° antihorario). Ej. YOJI 2026: `--rotar=7:cw,9:cw,10:ccw`.
 *   Usa Chrome (puppeteer-core) porque el entorno no tiene ImageMagick/sharp;
 *   requiere PUPPETEER_EXECUTABLE_PATH o Chrome instalado en ruta conocida.
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
// --rotar=7:cw,9:cw,10:ccw  → páginas apaisadas que en el PDF quedaron giradas.
// Se rotan tras convertir y antes de subir, para que queden derechas de forma
// PERMANENTE (sobrevive a re-subir el PDF). cw=90°, ccw=-90°, 180=180°.
const ROTAR = parseRotar(String(args.rotar || ''));

function parseRotar(spec) {
  const map = { cw: 90, horario: 90, ccw: -90, antihorario: -90, '180': 180 };
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(tok => {
    const [pg, dir] = tok.split(':');
    const n = parseInt(pg, 10);
    const raw = String(dir || 'cw').toLowerCase();
    const deg = raw in map ? map[raw] : parseInt(raw, 10);
    if (!Number.isInteger(n) || ![90, -90, 180].includes(deg)) {
      throw new Error(`--rotar inválido en "${tok}" (usa N:cw|ccw|180)`);
    }
    return { n, deg };
  });
}

if (!CODIGO || !PDF_PATH) {
  console.error('Uso: node scripts/upload-libro-interactivo.js --codigo=BEGINNER --pdf=./libro.pdf [--titulo="..."] [--dpi=150] [--rotar=7:cw,10:ccw] [--apply]');
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

/** Resuelve el ejecutable de Chrome/Chromium (env var o rutas conocidas). */
function resolveChrome() {
  const cands = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = cands.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) throw new Error('No se encontró Chrome. Define PUPPETEER_EXECUTABLE_PATH.');
  return found;
}

/**
 * Rota en su sitio las páginas apaisadas (page-NNN.jpg del tmpDir) con Chrome
 * (canvas). No hay ImageMagick/sharp en el entorno; puppeteer-core sí está.
 */
async function rotatePagesInPlace(rotar, tmpDir, totalPaginas) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(), headless: 'new', args: ['--no-sandbox'],
  });
  try {
    const pg = await browser.newPage();
    for (const { n, deg } of rotar) {
      if (n < 1 || n > totalPaginas) { console.log(`   ⚠ pág ${n} fuera de rango, se omite`); continue; }
      const file = path.join(tmpDir, `page-${String(n).padStart(3, '0')}.jpg`);
      const dataUri = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
      const out = await pg.evaluate(async (uri, d) => {
        const img = new Image(); img.src = uri; await img.decode();
        const c = document.createElement('canvas'); const ctx = c.getContext('2d');
        if (Math.abs(d) === 90) { c.width = img.height; c.height = img.width; }
        else { c.width = img.width; c.height = img.height; }
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(d * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        return c.toDataURL('image/jpeg', 0.92);
      }, dataUri, deg);
      fs.writeFileSync(file, Buffer.from(out.split(',')[1], 'base64'));
      console.log(`   ✅ pág ${n} rotada ${deg}°`);
    }
  } finally {
    await browser.close();
  }
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

    if (ROTAR.length) {
      console.log(`   Páginas a rotar: ${ROTAR.map(r => `${r.n}(${r.deg}°)`).join(', ')}`);
    }

    if (!APPLY) {
      console.log('🟡 DRY-RUN: no se subió a Spaces ni se tocó BD.');
      console.log(`   En modo --apply se subirá ${totalPaginas} JPGs a:`);
      console.log(`   materials/interactive/${CODIGO}/page-001.jpg ... page-${String(totalPaginas).padStart(3, '0')}.jpg`);
      if (ROTAR.length) console.log(`   (rotando ${ROTAR.length} página(s) apaisada(s) antes de subir)`);
      console.log(`   Y se hará UPSERT en LIBROS_INTERACTIVOS con totalPaginas=${totalPaginas}.\n`);
      return;
    }

    // 1b) Rotar páginas apaisadas (--rotar). Usa Chrome (canvas) porque el entorno
    //     no tiene ImageMagick/sharp; re-encodea el JPG derecho, en su sitio.
    if (ROTAR.length) {
      console.log(`\n1b) Rotando ${ROTAR.length} página(s) apaisada(s)…`);
      await rotatePagesInPlace(ROTAR, tmpDir, totalPaginas);
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
    console.log('   1. (Opcional) Sube los audios por página desde /dashboard/academic/actualizar-material/interactivo');
    console.log('   2. El libro aparece en el panel del estudiante del curso en cuanto tiene páginas (ya no hay feature flag).\n');

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
