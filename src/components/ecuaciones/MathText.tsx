'use client';

import { useMemo } from 'react';
import 'katex/dist/katex.min.css';
import { renderMathText } from '@/lib/math-render';

/**
 * Renderiza texto que puede contener ecuaciones LaTeX (`$...$` / `$$...$$`) usando
 * KaTeX. Usado en el quiz de actividades complementarias y en la vista previa del
 * editor de contenido.
 *
 * - `block` → contenedor con `whitespace-pre-wrap` (respeta saltos de línea del temario).
 * - inline (default) → `<span>` para incrustar en párrafos / opciones.
 */
export default function MathText({
  children,
  className,
  block = false,
}: {
  children: string;
  className?: string;
  block?: boolean;
}) {
  const html = useMemo(() => renderMathText(children || ''), [children]);
  if (block) {
    return (
      <div
        className={`whitespace-pre-wrap ${className || ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
