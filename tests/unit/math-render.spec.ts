import { test, expect } from '@playwright/test';
import { renderMathText, hasMath } from '../../src/lib/math-render';

/**
 * El `$` es a la vez el delimitador de LaTeX y el signo de peso, y los enunciados
 * de matemáticas están llenos de precios. Estas pruebas fijan las dos salidas:
 * un renglón por precio funciona tal cual, y `\$` sirve para el resto.
 */

/** El texto que quedó de un enunciado real (Módulo 00, alimento para perros). */
const PRECIOS = [
  '- El saco de 20 kg se vende a $33.500.',
  '- El saco de 15 kg se vende a $25.000.',
  '- El saco de 12 kg se vende a $20.000.',
  '- El saco de 5 kg se vende a $10.000.',
].join('\n');

test.describe('Precios en el enunciado', () => {
  test('un precio por renglón sale como texto, no como fórmula', () => {
    const html = renderMathText(PRECIOS);
    expect(html).not.toContain('katex');
    for (const monto of ['$33.500', '$25.000', '$20.000', '$10.000']) {
      expect(html).toContain(monto);
    }
  });

  test('el texto entre dos precios no se lo come la fórmula', () => {
    // El bug: "$33.500.\n- El saco de 15 kg se vende a $" se renderizaba entero.
    expect(renderMathText(PRECIOS)).toContain('El saco de 15 kg');
  });

  test('`\\$` da un signo de peso literal, aunque haya dos en el mismo renglón', () => {
    const html = renderMathText('Cuesta \\$10.000 o \\$20.000 según el tamaño.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$10.000');
    expect(html).toContain('$20.000');
    expect(html).toContain('según el tamaño');
  });

  test('dos precios SIN escapar en el mismo renglón sí se emparejan — para eso está `\\$`', () => {
    // Se deja documentado a propósito: en un renglón no hay forma de distinguir
    // un precio de una fórmula, así que manda el escape.
    expect(renderMathText('Cuesta $10.000 o $20.000.')).toContain('katex');
  });
});

test.describe('Las ecuaciones siguen funcionando', () => {
  test('en línea', () => {
    expect(renderMathText('La incógnita es $x^2 + 1$ aquí.')).toContain('katex');
  });

  test('en bloque, y puede ocupar varios renglones', () => {
    const html = renderMathText('Resuelve:\n$$\n\\frac{a}{b}\n$$\nfin.');
    expect(html).toContain('katex');
    expect(html).toContain('fin.');
  });

  test('una ecuación en línea NO cruza el salto de renglón', () => {
    expect(renderMathText('primero $a\nsegundo b$')).not.toContain('katex');
  });
});

test.describe('hasMath sigue la misma regla', () => {
  test('los precios en renglones distintos no cuentan como fórmula', () => {
    expect(hasMath(PRECIOS)).toBe(false);
  });

  test('un `\\$` escapado tampoco', () => {
    expect(hasMath('Cuesta \\$10.000 o \\$20.000.')).toBe(false);
  });

  test('una ecuación de verdad sí', () => {
    expect(hasMath('vale $x^2$')).toBe(true);
    expect(hasMath('vale $$x^2$$')).toBe(true);
  });
});
