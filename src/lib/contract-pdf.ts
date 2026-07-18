import 'server-only';
import fs from 'fs';
import path from 'path';

/**
 * Presentación del PDF del contrato: HTML + membrete (logo + Nº de contrato) y
 * pie con "Página X de Y".
 *
 * Vive aquí porque el contrato se genera desde TRES sitios —send-pdf (WhatsApp al
 * cliente), auto-approve y regenerate-drive (Drive)— y hasta ahora cada uno tenía
 * su propia copia del HTML. Con una sola definición los tres PDFs salen idénticos
 * y no pueden divergir al tocar uno.
 *
 * Los dos motores en uso aceptan estas mismas opciones (verificado con ambos):
 *   - puppeteer-core (regenerate-drive) → page.pdf(options)
 *   - API2PDF (send-pdf, auto-approve)  → body.options
 * Por eso el header/footer se define una vez y sirve para los dos.
 */

/** Márgenes: el top/bottom deben dejar sitio al membrete y al pie. */
export const CONTRACT_MARGIN = { top: '25mm', bottom: '18mm', left: '20mm', right: '15mm' };

/**
 * Nombre del archivo del contrato en Drive, SIN extensión: `MOS_<contrato>`.
 *
 * Lo usan los tres flujos que archivan el contrato (send-pdf, auto-approve y
 * regenerate-drive) para que el mismo contrato no aparezca en Drive con dos
 * nombres distintos. El Nº de contrato es único por titular, así que sirve además
 * como clave de sobreescritura al regenerar; sin él se cae al id del titular.
 *
 * OJO: NO es el nombre del adjunto que recibe el cliente por WhatsApp — ese es
 * aparte y va con el nombre de la persona ("Leydi Ladino 240004844.pdf").
 *
 * bsl-utilidades le agrega el ".pdf" (recibe esto como `documento`); el Drive
 * propio (uploadPdfToDrive) espera el nombre ya con extensión.
 */
export function buildContractFileBase(contrato?: string | null, titularId?: string | null): string {
  return contrato ? `MOS_${contrato}` : `MOS_SIN-CONTRATO_${titularId || 'desconocido'}`;
}

// El logo se lee del disco una vez y se cachea: va embebido como data URI en cada
// PDF (en el header de Chrome las URLs externas no cargan, tiene que ser data:).
// Se usa `logo-contrato.png` (160px, ~16 KB) y NO `logo.png` (1525px, 66 KB): el
// membrete lo muestra a 8mm y la imagen se repite en CADA página, así que el logo
// grande cuadruplicaba el peso del PDF (119 KB vs 47 KB en una prueba de 3 págs).
let logoCache: string | null | undefined;

function getLogoDataUri(): string | null {
  if (logoCache !== undefined) return logoCache;
  try {
    const file = path.join(process.cwd(), 'public', 'logo-contrato.png');
    logoCache = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch (err: any) {
    // Sin logo el contrato igual se genera (sólo pierde el membrete).
    console.warn('[contract-pdf] no se pudo leer el logo:', err?.message || err);
    logoCache = null;
  }
  return logoCache;
}

/** Escapa texto para incrustarlo en el HTML del membrete. */
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Membrete: logo a la izquierda, Nº de contrato a la derecha. En cada página. */
export function buildHeaderTemplate(contrato?: string | null): string {
  const logo = getLogoDataUri();
  const img = logo
    ? `<img src="${logo}" style="height:9mm;width:auto;display:block" />`
    : `<span style="font-weight:bold;color:#3b1d8a">MOSAICO</span>`;
  const num = contrato ? `<span>Contrato ${esc(contrato)}</span>` : '<span></span>';
  // -webkit-print-color-adjust:exact → sin esto Chrome puede lavar los colores.
  return `<div style="width:100%;padding:4mm 15mm 0 20mm;display:flex;align-items:center;justify-content:space-between;font-family:Georgia,'Times New Roman',serif;font-size:8pt;color:#666;-webkit-print-color-adjust:exact">${img}${num}</div>`;
}

/** Pie: "Página X de Y" centrado. pageNumber/totalPages los rellena Chrome. */
export function buildFooterTemplate(): string {
  return `<div style="width:100%;padding:0 15mm 0 20mm;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:8pt;color:#666">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`;
}

/** Opciones de PDF comunes a los dos motores (puppeteer y API2PDF). */
export function buildContractPdfOptions(contrato?: string | null) {
  return {
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: buildHeaderTemplate(contrato),
    footerTemplate: buildFooterTemplate(),
    // Los DOS motores esperan el margen en formato distinto y cada uno LEE el suyo
    // (ignora el otro), así que van ambos:
    //   - puppeteer (regenerate-drive) → objeto `margin` (htmlToPdfBuffer sólo lee éste).
    //   - API2PDF (send-pdf/auto-approve/autoaprobar) → campos PLANOS marginTop/…
    // API2PDF IGNORA el objeto `margin` → sin los planos usaba sus márgenes por
    // defecto (chicos) y el logo del membrete se montaba sobre la 1ª línea del
    // cuerpo ("Número de contrato"). Verificado con ambos motores.
    margin: CONTRACT_MARGIN,
    marginTop: CONTRACT_MARGIN.top,
    marginBottom: CONTRACT_MARGIN.bottom,
    marginLeft: CONTRACT_MARGIN.left,
    marginRight: CONTRACT_MARGIN.right,
  };
}

/**
 * HTML del contrato. El texto ya viene armado por `fillContractTemplate`; aquí
 * sólo se le pone tipografía y se respeta el formato con `white-space: pre-wrap`.
 *
 * OJO: no lleva `@page { margin }`. Los márgenes van en las opciones del PDF —
 * si se definieran en el CSS pisarían al header/footer, que viven justamente en
 * el margen de la página.
 */
export function buildContractHtml(contractText: string, contrato?: string | null): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contrato ${esc(contrato || '')}</title>
  <style>
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10.5pt;
      line-height: 1.5;
      color: #111;
      margin: 0;
      padding: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>${contractText}</body>
</html>`;
}
