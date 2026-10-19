/**
 * Boletas y facturas electrónicas del SII (las que emite MOSAICO CHILE SPA) —
 * leer el número desde el TEXTO del PDF.
 *
 * Los documentos electrónicos del SII traen capa de texto, así que el número se
 * lee sin IA y al instante. Formatos reales vistos:
 *   Boleta:  "BOLETA EXENTA ELECTRÓNICA NUMERO: \n69.351"  …  "Monto Total\n$ 138.000"
 *   Factura: "FACTURA NO AFECTA O\nEXENTA ELECTRONICA\nNº246" … "TOTAL$769.000"
 *
 * Se guarda CON PREFIJO (decisión del usuario): B-69351 / F-246. Boletas y
 * facturas tienen series distintas y así nunca se confunden.
 *
 * Puro (cliente y servidor), para poder probarlo sin base ni archivos.
 */

export type TipoDocTributario = 'BOLETA' | 'FACTURA'

export interface DocTributarioLeido {
  tipo: TipoDocTributario
  /** Sólo dígitos: "69351", "246". */
  numero: string
  /** Lo que se guarda en PAGOS_TITULARES.numeroFactura: "B-69351", "F-246". */
  numeroFactura: string
  monto: number | null
  /** RUT del receptor, normalizado sin puntos ni guión: "127823685". */
  rutReceptor: string | null
}

/** RUT del EMISOR (MOSAICO CHILE SPA): nunca es el del receptor. */
export const RUT_EMISOR_MOSAICO = '777449664'

export const PREFIJO_DOC: Record<TipoDocTributario, string> = { BOLETA: 'B', FACTURA: 'F' }

export function numeroConPrefijo(tipo: TipoDocTributario, numero: string): string {
  return `${PREFIJO_DOC[tipo]}-${String(numero).replace(/\D/g, '')}`
}

/** "12.782.368-5" / "76.745.458- 9" → "127823685"; la K va en mayúscula. */
export function normalizarRut(rut: string | null | undefined): string {
  return String(rut || '').toUpperCase().replace(/[^0-9K]/g, '')
}

const RUT_RE = /(\d{1,2}\.?\d{3}\.?\d{3})\s*-\s*([\dkK])/g

/** Monto chileno: el punto separa miles ("769.000" → 769000). */
const aPesos = (s: string) => {
  const n = Number(String(s).replace(/\./g, '').replace(/,\d{1,2}$/, '').replace(/\D/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function parsearDocumentoTributario(textoCrudo: string): DocTributarioLeido | null {
  const texto = String(textoCrudo || '').replace(/\r/g, '')
  let tipo: TipoDocTributario | null = null
  let numero: string | null = null

  // Boleta: "BOLETA … NUMERO: 69.351" (el número puede venir en la línea siguiente).
  const b = texto.match(/BOLETA[^\n]*?N[ÚU]MERO\s*:?\s*([\d.]+)/i)
  if (b) { tipo = 'BOLETA'; numero = b[1] }
  // Factura: "FACTURA … ELECTRONICA … Nº246" / "N° 246" / "Folio 246".
  if (!numero) {
    const f = texto.match(/FACTURA[\s\S]{0,120}?(?:N\s*[º°o]\.?|FOLIO)\s*:?\s*([\d.]+)/i)
    if (f) { tipo = 'FACTURA'; numero = f[1] }
  }
  if (!tipo || !numero) return null
  const digitos = numero.replace(/\D/g, '')
  if (!digitos) return null

  // Monto: el ÚLTIMO "TOTAL" del documento (antes vienen "EXENTO" e "IMPUESTO").
  // El PDF de la factura repite la hoja (copia cedible), así que se toma el primero
  // de cada página; basta con el primero que aparezca.
  const totales = Array.from(texto.matchAll(/(?:MONTO\s+TOTAL|(?:^|\n)\s*TOTAL)\s*\$?\s*([\d.]+)/gi))
  const monto = totales.length ? aPesos(totales[0][1]) : null

  // Receptor: el primer RUT DESPUÉS de "SEÑOR(ES)" que no sea el de MOSAICO
  // (en la boleta, antes viene el RUT del vendedor; en la factura, el emisor).
  let rutReceptor: string | null = null
  const desde = texto.search(/SE[ÑN]OR\s*\(?ES\)?/i)
  if (desde >= 0) {
    for (const m of Array.from(texto.slice(desde).matchAll(RUT_RE))) {
      const r = normalizarRut(`${m[1]}${m[2]}`)
      if (r !== RUT_EMISOR_MOSAICO) { rutReceptor = r; break }
    }
  }

  return { tipo, numero: digitos, numeroFactura: numeroConPrefijo(tipo, digitos), monto, rutReceptor }
}
