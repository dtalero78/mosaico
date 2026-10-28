import { test, expect } from '@playwright/test';
import { normalizarSalon, claveCurso, sqlMismoSalon } from '@/lib/curso-salon';

/**
 * El salón es parte de la identidad de un curso (campaña + tipo + horario + salón).
 * Caso que lo originó (oct-2026): KODOMO · MAR-JUE 18:15-19:15 ya tenía el Salón 5 y se
 * quería abrir el Salón 9 con el mismo horario.
 */
test.describe('Identidad del curso con salón', () => {
  test('el salón se guarda sólo como su número ("Salon 9" → "9")', () => {
    expect(normalizarSalon('Salon 9')).toBe('9');
    expect(normalizarSalon('Salón 9')).toBe('9');
    expect(normalizarSalon(' 9 ')).toBe('9');
    expect(normalizarSalon('SALÓN  12')).toBe('12');
    expect(normalizarSalon('5')).toBe('5');
  });

  test('vacío o nulo no es un salón', () => {
    expect(normalizarSalon('')).toBeNull();
    expect(normalizarSalon('   ')).toBeNull();
    expect(normalizarSalon(null)).toBeNull();
    expect(normalizarSalon(undefined)).toBeNull();
    expect(normalizarSalon('Salón')).toBeNull();
  });

  test('dos salones con el mismo horario tienen claves distintas', () => {
    const base = { campaign: 'OCTUBRE192026M', tipoCurso: 'KODOMO', horarioCurso: 'MAR-JUE 18:15-19:15' };
    expect(claveCurso({ ...base, salon: '5' })).not.toBe(claveCurso({ ...base, salon: '9' }));
    // "Salon 9" y "9" son el MISMO salón.
    expect(claveCurso({ ...base, salon: 'Salon 9' })).toBe(claveCurso({ ...base, salon: '9' }));
  });

  test('la igualdad SQL tolera nulos', () => {
    expect(sqlMismoSalon('cc', 'p')).toBe('cc."salon" IS NOT DISTINCT FROM p."salon"');
  });
});
