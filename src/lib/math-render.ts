import katex from 'katex';

/**
 * Renderiza un texto que mezcla texto plano con ecuaciones LaTeX delimitadas por
 * `$$...$$` (bloque) o `$...$` (en línea), devolviendo HTML. Las ecuaciones se
 * renderizan con KaTeX; el resto del texto se escapa. Fuente única usada por el
 * renderizador de MathLive/KaTeX (quiz, vista previa de contenido).
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

export function renderMathText(input: string): string {
  if (!input) return '';
  const parts: string[] = [];
  // $$...$$ (display) | $...$ (inline). El grupo no captura `$` internos.
  const regex = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    if (m.index > last) parts.push(escapeHtml(input.slice(last, m.index)));
    const display = m[1] != null;
    const latex = (m[1] ?? m[2] ?? '').trim();
    try {
      parts.push(katex.renderToString(latex, { throwOnError: false, displayMode: display }));
    } catch {
      parts.push(escapeHtml(m[0]));
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
