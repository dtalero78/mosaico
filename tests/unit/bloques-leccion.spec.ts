import { test, expect } from '@playwright/test';
import {
  leccionesPorSesion, esSesionDoble, leccionesDeSesion, INICIO_DOS_BLOQUES,
} from '../../src/lib/bloques-leccion';

test.describe('Cuántas lecciones cubre una sesión', () => {
  test('las cuatro de sábado que existen hoy son de dos bloques', () => {
    // Duran dos horas y se dictan en dos bloques, uno por lección.
    for (const h of ['SÁB 09:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00', 'SÁB 11:15-13:15']) {
      expect(leccionesPorSesion(h), h).toBe(2);
    }
  });

  test('las de entre semana cubren una', () => {
    for (const h of [
      'LUN-MIÉ 17:00-18:00', 'MAR-JUE 18:15-19:15', 'LUN-MIÉ 19:30-20:30',
      'LUN-MIÉ 19:00-19:50', 'LUN-MIÉ 20:00-20:50', 'LUN-MIÉ-VIE 20:00-21:00',
    ]) {
      expect(leccionesPorSesion(h), h).toBe(1);
    }
  });

  test('la regla sale de la DURACIÓN, no del día — un sábado corto cuenta como una', () => {
    // Si mañana Académico crea "SÁB 09:00-10:00", cubre una lección, no dos.
    expect(leccionesPorSesion('SÁB 09:00-10:00')).toBe(1);
    // Y un horario largo entre semana cubriría dos, aunque hoy no exista ninguno.
    expect(leccionesPorSesion('MAR-JUE 17:00-19:00')).toBe(2);
  });

  test('un horario ilegible no duplica lecciones por accidente', () => {
    expect(leccionesPorSesion('')).toBe(1);
    expect(leccionesPorSesion(null)).toBe(1);
    expect(leccionesPorSesion('sábados por la mañana')).toBe(1);
  });

  test('tolera el sábado sin tilde', () => {
    expect(leccionesPorSesion('SAB 09:00-11:00')).toBe(2);
  });

  test('esSesionDoble es la misma regla en booleano', () => {
    expect(esSesionDoble('SÁB 09:00-11:00')).toBe(true);
    expect(esSesionDoble('LUN-MIÉ 17:00-18:00')).toBe(false);
  });
});

test.describe('El corte: las clases ya dictadas conservan su lección', () => {
  test('antes del corte, un sábado sigue cubriendo UNA lección', () => {
    // Se dictó bajo la regla vieja; volver a repartirla correría todo el currículo.
    expect(leccionesDeSesion('2026-08-08', 'SÁB 09:00-11:00')).toBe(1);
    expect(leccionesDeSesion('2026-01-10', 'SÁB 11:00-13:00')).toBe(1);
  });

  test('desde el corte, cubre dos', () => {
    expect(leccionesDeSesion(INICIO_DOS_BLOQUES, 'SÁB 09:00-11:00')).toBe(2);
    expect(leccionesDeSesion('2026-08-22', 'SÁB 09:00-11:00')).toBe(2);
    expect(leccionesDeSesion('2027-03-06', 'SÁB 11:15-13:15')).toBe(2);
  });

  test('el corte no toca las de entre semana ni antes ni después', () => {
    expect(leccionesDeSesion('2026-08-08', 'LUN-MIÉ 17:00-18:00')).toBe(1);
    expect(leccionesDeSesion('2026-12-01', 'LUN-MIÉ 17:00-18:00')).toBe(1);
  });

  test('acepta Date además de texto (así llega desde la BD)', () => {
    expect(leccionesDeSesion(new Date('2026-08-22T05:00:00Z'), 'SÁB 09:00-11:00')).toBe(2);
    expect(leccionesDeSesion(new Date('2026-08-08T05:00:00Z'), 'SÁB 09:00-11:00')).toBe(1);
  });

  test('sin fecha no duplica', () => {
    expect(leccionesDeSesion(null, 'SÁB 09:00-11:00')).toBe(1);
  });
});
