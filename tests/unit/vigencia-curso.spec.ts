import { test, expect } from '@playwright/test';
import { finEfectivoCurso, vigenciasSeSolapan } from '@/lib/vigencia-curso';

/**
 * Cuándo el horario de un guía sigue ocupado por un curso.
 *
 * El caso que originó la regla (sep-2026): el guía de ENERO262026M · SENPAI · 03
 * (26-ene → 22-sep, última clase el 12-sep) no se podía asignar a un curso de
 * AGOSTO172026M a la misma hora, porque los dos periodos se habían pisado entre
 * agosto y septiembre — un solape que ya había pasado.
 */

const HOY = '2026-09-23';

test.describe('Fin efectivo del curso', () => {
  test('manda la última clase cuando cae después del final nominal', () => {
    // Las clases que caen en festivo se corren al final: el curso termina después.
    expect(finEfectivoCurso('2027-06-22', '2027-07-10')).toBe('2027-07-10');
  });

  test('manda el final nominal cuando la última clase es anterior', () => {
    expect(finEfectivoCurso('2026-09-22', '2026-09-12')).toBe('2026-09-22');
  });

  test('sin última clase se usa el final nominal, y al revés', () => {
    expect(finEfectivoCurso('2026-09-22', null)).toBe('2026-09-22');
    expect(finEfectivoCurso(null, '2026-09-12')).toBe('2026-09-12');
    expect(finEfectivoCurso(null, null)).toBeNull();
  });

  test('tolera una fecha con hora pegada', () => {
    expect(finEfectivoCurso('2026-09-22T00:00:00.000Z', null)).toBe('2026-09-22');
  });
});

test.describe('Solape de vigencias de hoy en adelante', () => {
  test('el curso que YA TERMINÓ deja libre al guía', () => {
    // ENERO262026M (terminado ayer) vs AGOSTO172026M (en curso): no chocan.
    const r = vigenciasSeSolapan('2026-08-22', '2027-06-22', '2026-01-26', '2026-09-22', HOY);
    expect(r.solapan).toBe(false);
  });

  test('si termina HOY todavía ocupa: la clase de hoy aún no se ha dictado', () => {
    const r = vigenciasSeSolapan('2026-08-22', '2027-06-22', '2026-01-26', HOY, HOY);
    expect(r.solapan).toBe(true);
  });

  test('dos cursos vigentes que se pisan siguen chocando', () => {
    const r = vigenciasSeSolapan('2026-08-22', '2027-06-22', '2026-09-01', '2027-01-30', HOY);
    expect(r.solapan).toBe(true);
    expect(r.indeterminada).toBe(false);
  });

  test('campañas encadenadas (una empieza cuando la otra acaba) no chocan', () => {
    const r = vigenciasSeSolapan('2027-07-01', '2028-03-01', '2026-09-24', '2027-06-30', HOY);
    expect(r.solapan).toBe(false);
  });

  test('sin fechas no se puede descartar: se avisa y se marca indeterminada', () => {
    const r = vigenciasSeSolapan('2026-08-22', null, '2026-09-01', '2027-01-30', HOY);
    expect(r.solapan).toBe(true);
    expect(r.indeterminada).toBe(true);
  });

  test('un curso terminado se descarta aunque al otro le falten fechas', () => {
    // El terminado manda: no hay nada que avisar aunque la otra vigencia sea un hueco.
    const r = vigenciasSeSolapan(null, null, '2026-01-26', '2026-09-22', HOY);
    expect(r.solapan).toBe(false);
    expect(r.indeterminada).toBe(false);
  });
});
