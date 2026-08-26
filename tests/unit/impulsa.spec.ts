import { test, expect } from '@playwright/test';
import { computeImpulsaCalendario } from '../../src/lib/impulsa-calendario';
import { esFestivoChile } from '../../src/lib/festivos-chile';

/**
 * IMPULSA no aplica el calendario de festivos.
 *
 * Es la diferencia de fondo con los cursos MOSAICO y por eso está fijada aquí: un
 * curso IMPULSA es intensivo y cierra su calendario al crearse, así que dicta en
 * los feriados salvo que su propio asistente diga lo contrario. Si alguien vuelve
 * a colgar `esFestivoChile` o los festivos declarados dentro del cálculo, estas
 * pruebas lo cazan.
 */

const BASE = {
  inicioSesiones: '2026-09-07',
  finSesiones: '2026-09-25',
  festivos: [] as string[],
  entrenamientos: [] as any[],
  evaluaciones: [] as any[],
};

test.describe('Calendario IMPULSA y los festivos', () => {
  test('el 18 de septiembre es feriado legal en Chile (control del dato)', () => {
    expect(esFestivoChile('2026-09-18')).toBe(true);
    expect(esFestivoChile('2026-10-19')).toBe(true);
  });

  test('dicta clase en feriado legal: no se salta el 18 de septiembre', () => {
    const { sesiones, resumen } = computeImpulsaCalendario(BASE);
    const fechas = sesiones.map(s => s.fecha);
    expect(fechas).toContain('2026-09-18');
    expect(resumen.festivosOmitidos).toEqual([]);
  });

  test('sólo salta los días cargados en SU propio asistente', () => {
    const { sesiones, resumen } = computeImpulsaCalendario({ ...BASE, festivos: ['2026-09-16'] });
    const fechas = sesiones.map(s => s.fecha);
    expect(fechas).not.toContain('2026-09-16');
    expect(fechas).toContain('2026-09-18');   // feriado legal, se dicta igual
    expect(resumen.festivosOmitidos).toEqual(['2026-09-16']);
  });

  test('la clase saltada se corre al final: el curso conserva su número de sesiones', () => {
    const sin = computeImpulsaCalendario(BASE);
    const con = computeImpulsaCalendario({ ...BASE, festivos: ['2026-09-16'] });
    expect(con.sesiones.length).toBe(sin.sesiones.length);
    // La reposición cae después del fin de la ventana.
    expect(con.sesiones[con.sesiones.length - 1].fecha > BASE.finSesiones).toBe(true);
  });

  test('las sesiones caen sólo en lunes, miércoles y viernes', () => {
    const { sesiones } = computeImpulsaCalendario(BASE);
    for (const s of sesiones) {
      const dow = new Date(s.fecha + 'T12:00:00Z').getUTCDay();
      expect([1, 3, 5]).toContain(dow);
    }
  });
});
