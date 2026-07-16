import 'server-only';
import fs from 'fs';
import puppeteer, { type Browser } from 'puppeteer-core';

/**
 * Generación de PDF con Chromium propio (puppeteer-core), sin depender de API2PDF.
 *
 * Usamos puppeteer-CORE (no `puppeteer`) a propósito: `puppeteer` descarga su
 * propio Chromium (~150MB) que además NO corre en Alpine (está compilado contra
 * glibc y la imagen usa musl). En su lugar el Dockerfile instala el Chromium de
 * Alpine y lo apuntamos con PUPPETEER_EXECUTABLE_PATH.
 *
 * MEMORIA: el servicio corre en 1 GB. Next ocupa ~300MB, así que a Chromium le
 * quedan ~600MB. Por eso:
 *   - `--single-process` + `--no-zygote`: un solo proceso en vez de uno por pestaña.
 *   - `--disable-dev-shm-usage`: /dev/shm en contenedores es de 64MB; sin esto
 *     Chromium casca al renderizar páginas grandes.
 *   - El navegador se cierra SIEMPRE (finally) — una instancia colgada se come
 *     la RAM del contenedor y tumba la app.
 *   - `MAX_CONCURRENT`: se serializan las generaciones. Dos Chromium a la vez no
 *     caben en 1 GB.
 */

const CHROME_PATHS_FALLBACK = [
  // Linux / Alpine (producción)
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  // Windows (desarrollo local)
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // macOS (desarrollo local)
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** Resuelve el ejecutable de Chromium: env var primero, luego rutas conocidas. */
export function resolveChromePath(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;
  const found = CHROME_PATHS_FALLBACK.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  if (!found) {
    throw new Error(
      'No se encontró Chromium. Define PUPPETEER_EXECUTABLE_PATH ' +
      '(en producción lo instala el Dockerfile en /usr/bin/chromium-browser).'
    );
  }
  return found;
}

// Serializa las generaciones: en 1 GB no caben dos Chromium simultáneos.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  // La cola no debe romperse si una generación falla.
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export interface PdfOptions {
  format?: 'A4' | 'Letter';
  printBackground?: boolean;
  /** Espera extra tras cargar el HTML (ms). Sólo si hay contenido async. */
  delayMs?: number;
  /** Membrete y pie repetidos en cada página (ver src/lib/contract-pdf.ts). */
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  /** Márgenes. Con header/footer hay que dejarles sitio en top/bottom. */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
}

/**
 * Renderiza HTML a un Buffer de PDF. Reemplaza la llamada a API2PDF
 * (`POST https://v2018.api2pdf.com/chrome/html`), que devolvía una URL temporal;
 * aquí obtenemos los bytes directamente, sin pasar por un tercero.
 */
export async function htmlToPdfBuffer(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  const {
    format = 'Letter', printBackground = true, delayMs = 0,
    displayHeaderFooter, headerTemplate, footerTemplate, margin,
  } = opts;

  return enqueue(async () => {
    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        executablePath: resolveChromePath(),
        headless: true,
        args: [
          '--no-sandbox',              // requerido: el contenedor corre como non-root sin userns
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',   // /dev/shm de 64MB en contenedores
          '--disable-gpu',
          '--single-process',          // clave para 1 GB
          '--no-zygote',
          '--disable-extensions',
          '--font-render-hinting=none',
        ],
      });

      const page = await browser.newPage();
      // El HTML del contrato es autocontenido (sin recursos externos), así que
      // 'load' basta; 'networkidle0' sólo añadiría segundos de espera.
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

      const pdf = await page.pdf({
        format,
        printBackground,
        // preferCSSPageSize sólo si el HTML NO trae márgenes propios: cuando hay
        // header/footer, los márgenes deben venir de las opciones (el membrete se
        // dibuja dentro del margen, y un @page del CSS lo dejaría sin sitio).
        ...(margin ? { margin } : { preferCSSPageSize: true }),
        ...(displayHeaderFooter ? { displayHeaderFooter, headerTemplate, footerTemplate } : {}),
      });
      return Buffer.from(pdf);
    } finally {
      // Cerrar SIEMPRE: un Chromium huérfano se come la RAM del contenedor.
      if (browser) await browser.close().catch(() => {});
    }
  });
}
