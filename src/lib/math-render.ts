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
    if (m.index > last) parts.push(escapeHtml(input.slice(last, m.index)));

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
      const url = safeUrl(m[4]);
      if (url) {
        parts.push(`<img src="${escapeAttr(url)}" alt="${escapeAttr(m[3] ?? '')}" class="inline-block max-w-full max-h-72 my-1 rounded border border-gray-200" />`);
      } else {
        parts.push(escapeHtml(m[0]));
      }
    } else if (m[6] != null) {
      // Link [texto](url)
      const url = safeUrl(m[6]);
      if (url) {
        parts.push(`<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline">${escapeHtml(m[5] ?? '')}</a>`);
      } else {
        parts.push(escapeHtml(m[0]));
      }
    }
    last = regex.lastIndex;
  }
  if (last < input.length) parts.push(escapeHtml(input.slice(last)));
  return parts.join('');
}

/** ¿El texto contiene al menos una ecuación LaTeX? */
export function hasMath(input: string): boolean {
  return /\$[^$]+\$/.test(input || '');
}
