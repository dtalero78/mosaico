/**
 * subir-libro-interactivo.js  (MOSAICO — reemplaza a upload-libro-interactivo.js)
 *
 * Sube un PDF de curso como "libro interactivo": lo convierte a JPG (una por
 * página), rota las páginas apaisadas, sube a DO Spaces
 * (`materials/interactive/{codigo}/page-NNN.jpg`) y registra el libro en
 * LIBROS_INTERACTIVOS. HACE TODO en un solo comando:
 *
 *   - Localiza `pdftoppm` (poppler) solo: PATH, ~/poppler/**, Program Files.
 *   - Localiza Chrome/Edge solo (para rotar; no hay ImageMagick/sharp).
 *   - Bucket por defecto: mosaico-bucket (de .env.local).
 *   - Crea la tabla LIBROS_INTERACTIVOS si no existe y hace UPSERT del libro.
 *   - Limpia páginas HUÉRFANAS en Spaces (si el PDF nuevo tiene menos páginas).
 *   - Rota páginas apaisadas: --rotar=7:cw,9:cw,10:ccw  (giro PERMANENTE, sobrevive
 *     a re-subir). Si hay `tesseract` en PATH y pasas --auto-rotar, detecta la
 *     orientación por página automáticamente (OSD); si no, usa --rotar.
 *
 * Uso:
 *   node scripts/subir-libro-interactivo.js \
 *     --codigo=YOJI \
 *     --pdf="./YOJI COLOR 2026.pdf" \
 *     [--titulo="Curso — MOSAICO 2026"] \
 *     [--dpi=150] \
 *     [--rotar=7:cw,9:cw,10:ccw] [--auto-rotar] \
 *     [--apply]
 *
 * Dry-run por defecto (cuenta páginas + reporta). Con --apply convierte, sube y
 * actualiza BD. Idempotente: re-ejecutar reemplaza imágenes y actualiza el conteo;
 * NO toca audios ni bindings de niveles.
 *
 * Rotaciones conocidas — YOJI 2026:  --rotar=7:cw,9:cw,10:ccw
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
const AUTO_ROTAR = !!args['auto-rotar'];
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
  console.error('Uso: node scripts/subir-libro-interactivo.js --codigo=YOJI --pdf="./libro.pdf" [--titulo="..."] [--dpi=150] [--rotar=7:cw,9:cw,10:ccw] [--auto-rotar] [--apply]');
  process.exit(1);
}
if (!fs.existsSync(PDF_PATH)) {
  console.error(`❌ No existe el archivo: ${PDF_PATH}`);
  process.exit(1);
}

const DB_URL = process.env.DATABASE_URL;
const S3_ENDPOINT = process.env.DO_SPACES_ENDPOINT || 'https://sfo3.digitaloceanspaces.com';
const S3_REGION = process.env.DO_SPACES_REGION || 'sfo3';
const S3_BUCKET = process.env.DO_SPACES_BUCKET || 'mosaico-bucket';
const S3_KEY = process.env.DO_SPACES_KEY;
const S3_SECRET = process.env.DO_SPACES_SECRET;

if (!DB_URL || !S3_KEY || !S3_SECRET) {
  console.error('❌ Faltan variables de entorno (DATABASE_URL / DO_SPACES_KEY / DO_SPACES_SECRET) en .env.local');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d.toString(); });
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 200)}`))));
  });
}

/** Busca un binario dentro de una carpeta (recursivo, profundidad limitada). */
function findInDir(root, names, depth = 4) {
  if (!root || depth < 0) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isFile() && names.includes(e.name)) return full;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findInDir(path.join(root, e.name), names, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Resuelve `pdftoppm`: env, PATH, ~/poppler, Program Files, rutas Unix. */
async function resolvePdftoppm() {
  const names = process.platform === 'win32' ? ['pdftoppm.exe'] : ['pdftoppm'];
  if (process.env.PDFTOPPM && fs.existsSync(process.env.PDFTOPPM)) return process.env.PDFTOPPM;
  // ¿está en PATH?
  try { await run('pdftoppm', ['-v']); return 'pdftoppm'; } catch (e) {
    if (!/enoent|not found|no such/i.test(e.message)) return 'pdftoppm'; // existe, error de otra índole
  }
  const roots = [
    path.join(os.homedir(), 'poppler'),
    'C:/Program Files', 'C:/Program Files (x86)', 'C:/poppler',
    '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin',
  ];
  for (const r of roots) {
    const hit = findInDir(r, names, r.startsWith('C:/Program') ? 3 : 4);
    if (hit) return hit;
  }
  console.error('\n❌ No se encontró `pdftoppm` (poppler). Instálalo o define PDFTOPPM:');
  console.error('   Windows: https://github.com/oschwartz10612/poppler-windows/releases');
  console.error('   macOS:   brew install poppler   ·   Ubuntu: sudo apt install poppler-utils\n');
  process.exit(1);
}

/** Resuelve Chrome/Edge (para rotar con canvas). */
function resolveChrome() {
  const cands = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = cands.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) throw new Error('No se encontró Chrome/Edge. Define PUPPETEER_EXECUTABLE_PATH.');
  return found;
}

/** Auto-detección de orientación por página con Tesseract OSD (si está y --auto-rotar). */
async function autoDetectRotations(tmpDir, renamed) {
  const names = process.platform === 'win32' ? ['tesseract.exe'] : ['tesseract'];
  let bin = null;
  try { await run('tesseract', ['--version']); bin = 'tesseract'; } catch {
    for (const r of ['C:/Program Files/Tesseract-OCR', 'C:/Program Files (x86)/Tesseract-OCR', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']) {
      const hit = findInDir(r, names, 2); if (hit) { bin = hit; break; }
    }
  }
  if (!bin) {
    console.log('   ⚠ Tesseract no está instalado → auto-rotar omitido (usa --rotar si hay páginas apaisadas).');
    return [];
  }
  const out = [];
  for (const p of renamed) {
    try {
      const { stdout } = await run(bin, [p.fullPath, 'stdout', '--psm', '0', '--dpi', String(DPI)]);
      const m = stdout.match(/Rotate:\s*(\d+)/i);
      const rot = m ? parseInt(m[1], 10) : 0;            // grados CW para enderezar
      const deg = rot === 90 ? 90 : rot === 270 ? -90 : rot === 180 ? 180 : 0;
      if (deg) { out.push({ n: p.n, deg }); console.log(`   🔎 pág ${p.n}: OSD sugiere ${deg}°`); }
    } catch { /* OSD falla en páginas sin texto — se ignora */ }
  }
  return out;
}

/** Rota en su sitio las páginas apaisadas (page-NNN.jpg) con Chrome (canvas). */
async function rotatePagesInPlace(rotar, tmpDir, totalPaginas) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: resolveChrome(), headless: 'new', args: ['--no-sandbox'] });
  try {
    const pg = await browser.newPage();
    for (const { n, deg } of rotar) {
      if (n < 1 || n > totalPaginas) { console.log(`   ⚠ pág ${n} fuera de rango, se omite`); continue; }
      const file = path.join(tmpDir, `page-${String(n).padStart(3, '0')}.jpg`);
      const dataUri = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
      const outUri = await pg.evaluate(async (uri, d) => {
        const img = new Image(); img.src = uri; await img.decode();
        const c = document.createElement('canvas'); const ctx = c.getContext('2d');
        if (Math.abs(d) === 90) { c.width = img.height; c.height = img.width; } else { c.width = img.width; c.height = img.height; }
        ctx.translate(c.width / 2, c.height / 2); ctx.rotate(d * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        return c.toDataURL('image/jpeg', 0.92);
      }, dataUri, deg);
      fs.writeFileSync(file, Buffer.from(outUri.split(',')[1], 'base64'));
      console.log(`   ✅ pág ${n} rotada ${deg}°`);
    }
  } finally {
    await browser.close();
  }
}

/** Borra en Spaces las páginas con índice > totalPaginas (huérfanas de una subida anterior). */
async function limpiarHuerfanas(s3, prefixS3, totalPaginas) {
  const toDelete = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefixS3, ContinuationToken }));
    for (const o of r.Contents || []) {
      const m = String(o.Key).match(/page-(\d+)\.jpg$/);
      if (m && parseInt(m[1], 10) > totalPaginas) toDelete.push({ Key: o.Key });
    }
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  if (!toDelete.length) return 0;
  for (let i = 0; i < toDelete.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: toDelete.slice(i, i + 1000) } }));
  }
  return toDelete.length;
}

// ── Main ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n📚 Libro interactivo (MOSAICO): ${CODIGO}`);
  console.log(`   PDF:    ${PDF_PATH}`);
  console.log(`   Bucket: ${S3_BUCKET}   DPI: ${DPI}`);
  console.log(`   Modo:   ${APPLY ? '🔴 APPLY' : '🟡 DRY-RUN'}\n`);

  const PDFTOPPM = await resolvePdftoppm();
  console.log(`   pdftoppm: ${PDFTOPPM}\n`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `libro-${CODIGO}-`));

  try {
    // 1) PDF → JPGs
    console.log('1) Convirtiendo PDF a imágenes JPG…');
    const prefix = path.join(tmpDir, 'page');
    await run(PDFTOPPM, ['-jpeg', '-r', String(DPI), '-jpegopt', 'quality=85', PDF_PATH, prefix]);

    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg'));
    const renamed = [];
    for (const f of files) {
      const m = f.match(/page-(\d+)\.jpg$/); if (!m) continue;
      const n = parseInt(m[1], 10);
      const newName = `page-${String(n).padStart(3, '0')}.jpg`;
      if (newName !== f) fs.renameSync(path.join(tmpDir, f), path.join(tmpDir, newName));
      renamed.push({ n, file: newName, fullPath: path.join(tmpDir, newName) });
    }
    renamed.sort((a, b) => a.n - b.n);
    const totalPaginas = renamed.length;
    console.log(`   ✅ ${totalPaginas} páginas generadas\n`);
    if (totalPaginas === 0) throw new Error('pdftoppm no generó ninguna imagen');

    // Rotaciones: manual (--rotar) + auto (OSD si --auto-rotar y tesseract presente)
    let rotaciones = [...ROTAR];
    if (AUTO_ROTAR) {
      console.log('   Detectando orientación (Tesseract OSD)…');
      const auto = await autoDetectRotations(tmpDir, renamed);
      const yaHay = new Set(rotaciones.map(r => r.n));
      for (const a of auto) if (!yaHay.has(a.n)) rotaciones.push(a);
    }
    if (rotaciones.length) console.log(`   Páginas a rotar: ${rotaciones.map(r => `${r.n}(${r.deg}°)`).join(', ')}`);

    if (!APPLY) {
      console.log('\n🟡 DRY-RUN: no se subió a Spaces ni se tocó BD.');
      console.log(`   Con --apply se subirán ${totalPaginas} JPGs a materials/interactive/${CODIGO}/page-001..${String(totalPaginas).padStart(3, '0')}.jpg`);
      if (rotaciones.length) console.log(`   (rotando ${rotaciones.length} página(s) apaisada(s) antes de subir)`);
      console.log(`   UPSERT LIBROS_INTERACTIVOS totalPaginas=${totalPaginas}${TITULO_FLAG ? `, titulo="${TITULO_FLAG}"` : ''}.\n`);
      return;
    }

    // 1b) Rotar
    if (rotaciones.length) {
      console.log(`\n1b) Rotando ${rotaciones.length} página(s) apaisada(s)…`);
      await rotatePagesInPlace(rotaciones, tmpDir, totalPaginas);
    }

    // 2) S3
    const s3 = new S3Client({
      endpoint: S3_ENDPOINT, region: S3_REGION,
      credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
      forcePathStyle: false,
      requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) }),
    });

    // 3) Subir
    console.log(`\n2) Subiendo ${totalPaginas} JPGs a Spaces (${S3_BUCKET})…`);
    const prefixS3 = `materials/interactive/${CODIGO}/`;
    let uploaded = 0;
    for (const p of renamed) {
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET, Key: prefixS3 + p.file, Body: fs.readFileSync(p.fullPath),
        ContentType: 'image/jpeg', ACL: 'private', CacheControl: 'private, max-age=86400',
      }));
      if (++uploaded % 10 === 0 || uploaded === totalPaginas) process.stdout.write(`\r   ${uploaded}/${totalPaginas}`);
    }
    console.log('\n   ✅ Upload completo');

    // 3b) Limpiar huérfanas (si el PDF nuevo tiene menos páginas que la subida previa)
    const borradas = await limpiarHuerfanas(s3, prefixS3, totalPaginas);
    if (borradas) console.log(`   🧹 ${borradas} página(s) huérfana(s) eliminada(s) de Spaces`);

    // 4) BD: asegurar tabla + UPSERT
    console.log('\n3) Actualizando BD…');
    const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS "LIBROS_INTERACTIVOS" (
           "codigo" TEXT PRIMARY KEY, "titulo" TEXT, "totalPaginas" INTEGER DEFAULT 0,
           "audios" JSONB DEFAULT '[]'::jsonb, "activo" BOOLEAN DEFAULT true,
           "_createdDate" TIMESTAMPTZ DEFAULT NOW(), "_updatedDate" TIMESTAMPTZ DEFAULT NOW() )`
      );
      const existing = await pool.query(`SELECT "titulo" FROM "LIBROS_INTERACTIVOS" WHERE "codigo"=$1`, [CODIGO]);
      const tituloFinal = TITULO_FLAG || existing.rows[0]?.titulo || CODIGO;
      await pool.query(
        `INSERT INTO "LIBROS_INTERACTIVOS" ("codigo","titulo","totalPaginas") VALUES ($1,$2,$3)
         ON CONFLICT ("codigo") DO UPDATE SET
           "titulo"=EXCLUDED."titulo", "totalPaginas"=EXCLUDED."totalPaginas", "_updatedDate"=NOW()`,
        [CODIGO, tituloFinal, totalPaginas]
      );
      console.log(`   ✅ LIBROS_INTERACTIVOS: ${CODIGO} — "${tituloFinal}" — ${totalPaginas} págs\n`);
    } finally {
      await pool.end();
    }

    console.log('🎉 Listo. El libro aparece en el panel del estudiante del curso en cuanto tiene páginas.');
    console.log('   (Opcional) Audios por página desde /dashboard/academic/actualizar-material/interactivo\n');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    try { for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f)); fs.rmdirSync(tmpDir); } catch {}
  }
})();
