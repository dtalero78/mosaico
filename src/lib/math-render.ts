import katex from 'katex';

/**
 * Renderiza un texto que mezcla texto plano con:
 *   - ecuaciones LaTeX  `$$...$$` (bloque) o `$...$` (en línea) → KaTeX
 *   - imágenes markdown  `![alt](url)` → <img>
 *   - links markdown     `[texto](url)` → <a target="_blank">
 * El resto del texto se escapa. Fuente única usada por el renderizador (quiz,
 * vista previa de contenido, respuestas de evaluación).
 *
 * NOTA: el HTML resultante requiere la hoja de estilos de KaTeX
 * (`katex/dist/katex.min.css`), que se importa desde el componente cliente
 * `MathText`.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Decodifica entidades HTML (nombradas + numéricas) a su carácter Unicode.
 * Los CSV tipo Tutor LMS traen tildes/signos como `&oacute;`, `&iquest;`,
 * `&minus;`, etc. Se aplica al texto plano ANTES de escaparlo, para que se vean
 * correctos tanto en importaciones nuevas como en las ya guardadas.
 */
const NAMED_ENTITIES: Record<string, string> = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ',
  iquest: '¿', iexcl: '¡', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  ndash: '–', mdash: '—', hellip: '…', deg: '°', middot: '·', times: '×', divide: '÷',
  plusmn: '±', le: '≤', ge: '≥', ne: '≠', minus: '−', frac12: '½', frac14: '¼', frac34: '¾',
  sup2: '²', sup3: '³', euro: '€', pound: '£', cent: '¢', copy: '©', reg: '®', trade: '™',
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};
export function decodeHtmlEntities(s: string): string {
  if (!s) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : whole; } catch { return whole; }
    }
    return NAMED_ENTITIES[ent] != null ? NAMED_ENTITIES[ent] : whole;
  });
}

/** Escapa una cadena para usarla dentro de un atributo HTML entre comillas dobles. */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * Sanea una URL: sólo permite http(s), rutas relativas (`/…`) y `mailto:`.
 * Cualquier otro esquema (p.ej. `javascript:`) se descarta → devuelve null.
 */
function safeUrl(url: string): string | null {
  const u = (url || '').trim();
  return /^(https?:\/\/|\/|mailto:)/i.test(u) ? u : null;
}

export function renderMathText(input: string): string {
  if (!input) return '';
  const parts: string[] = [];
  // $$display$$ | $inline$ | ![alt](url) imagen | [texto](url) link
  const regex = /\$\$([^$]+)\$\$|\$([^$]+)\$|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    if (m.index > last) parts.push(escapeHtml(decodeHtmlEntities(input.slice(last, m.index))));

    if (m[1] != null || m[2] != null) {
      // Ecuación LaTeX
      const display = m[1] != null;
      const latex = (m[1] ?? m[2] ?? '').trim();
      try {
        parts.push(katex.renderToString(latex, { throwOnError: false, displayMode: display }));
      } catch {
        parts.push(escapeHtml(m[0]));
      }
    } else if (m[4] != null) {
      // Imagen ![alt](url)
      const url = safeUrl(decodeHtmlEntities(m[4]));
      if (url) {
        // Imagen en BLOQUE y CENTRADA (su propia línea): el texto de la pregunta
        // queda ARRIBA y el texto que siga queda DEBAJO de la imagen.
        parts.push(`<img src="${escapeAttr(url)}" alt="${escapeAttr(m[3] ?? '')}" class="block mx-auto max-w-full max-h-96 my-3 rounded border border-gray-200" />`);
      } else {
        parts.push(escapeHtml(m[0]));
      }
    } else if (m[6] != null) {
      // Link [texto](url)
      const url = safeUrl(decodeHtmlEntities(m[6]));
      if (url) {
        parts.push(`<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline">${escapeHtml(m[5] ?? '')}</a>`);
      } else {
        parts.push(escapeHtml(m[0]));
      }
    }
    last = regex.lastIndex;
  }
  if (last < input.length) parts.push(escapeHtml(decodeHtmlEntities(input.slice(last))));
  return parts.join('');
}

/** ¿El texto contiene al menos una ecuación LaTeX? */
export function hasMath(input: string): boolean {
  return /\$[^$]+\$/.test(input || '');
}
