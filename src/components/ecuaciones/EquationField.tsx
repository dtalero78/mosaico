'use client';

import { useEffect, useRef } from 'react';

/**
 * Campo de edición WYSIWYG de ecuaciones basado en MathLive (`<math-field>`).
 * MathLive es un web component que solo existe en el navegador → se importa
 * dinámicamente y se instancia de forma imperativa (evita los problemas de
 * SSR/JSX con custom elements en Next.js). Emite el LaTeX en `onChange`.
 */
export default function EquationField({
  initial,
  onChange,
}: {
  initial?: string;
  onChange: (latex: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let mf: any;
    let disposed = false;
    import('mathlive')
      .then((ml: any) => {
        if (disposed || !hostRef.current) return;
        // Fuentes desde CDN (el bundle de Next no sirve la ruta por defecto) y
        // sin sonidos de teclado.
        try {
          ml.MathfieldElement.fontsDirectory = 'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/dist/fonts';
          ml.MathfieldElement.soundsDirectory = null;
        } catch {}
        mf = new ml.MathfieldElement();
        mf.value = initial || '';
        mf.style.width = '100%';
        mf.style.minHeight = '3.25rem';
        mf.style.fontSize = '1.25rem';
        mf.style.border = '1px solid #d1d5db';
        mf.style.borderRadius = '0.5rem';
        mf.style.padding = '0.5rem 0.75rem';
        mf.addEventListener('input', () => onChangeRef.current(mf.value));
        hostRef.current.appendChild(mf);
        setTimeout(() => { try { mf.focus(); } catch {} }, 60);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      try { mf?.remove?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="w-full" />;
}
