import { test, expect } from '@playwright/test';
import { esFestivoChile } from '../../src/lib/festivos-chile';

/**
 * Feriados de traslado de Chile. Se calculan por regla porque el JSON curado tenía
 * fechas equivocadas (19-oct-2026 en vez del 12) y, como el JSON SUMA, una fecha mal
 * escrita ahí crea un feriado falso. Las fechas de control son las oficiales.
 */

test('Encuentro de Dos Mundos (Ley 19.668)', () => {
  expect(esFestivoChile('2026-10-12')).toBe(true);  // lunes: se queda
  expect(esFestivoChile('2026-10-19')).toBe(false); // el error que había
  expect(esFestivoChile('2027-10-11')).toBe(true);  // 12 cae martes → lunes 11
  expect(esFestivoChile('2027-10-12')).toBe(false);
  expect(esFestivoChile('2027-10-18')).toBe(false);
  expect(esFestivoChile('2023-10-09')).toBe(true);  // 12 cae jueves → lunes 9
  expect(esFestivoChile('2024-10-12')).toBe(true);  // sábado: se queda
});

test('San Pedro y San Pablo (Ley 19.668)', () => {
  expect(esFestivoChile('2026-06-29')).toBe(true);  // lunes
  expect(esFestivoChile('2027-06-28')).toBe(true);  // 29 cae martes → lunes 28
  expect(esFestivoChile('2027-06-29')).toBe(false);
  expect(esFestivoChile('2023-06-26')).toBe(true);  // 29 cae jueves → lunes 26
});

test('Iglesias Evangélicas (Ley 20.299)', () => {
  expect(esFestivoChile('2026-10-31')).toBe(true);  // sábado
  expect(esFestivoChile('2023-10-27')).toBe(true);  // 31 cae martes → viernes 27
  expect(esFestivoChile('2023-10-31')).toBe(false);
  expect(esFestivoChile('2024-10-31')).toBe(true);  // jueves: se queda
});

test('el Jueves Santo no es feriado en Chile; el Viernes y el Sábado sí', () => {
  expect(esFestivoChile('2026-04-02')).toBe(false);
  expect(esFestivoChile('2026-04-03')).toBe(true);
  expect(esFestivoChile('2026-04-04')).toBe(true);
  expect(esFestivoChile('2027-03-25')).toBe(false);
  expect(esFestivoChile('2027-03-26')).toBe(true);
});
