import { test, expect } from '@playwright/test';
import { estadoWelcome, pasaFiltroAsistencia } from '@/lib/welcome-asistencia';
import { coincidePersona } from '@/lib/busqueda-persona';

/**
 * Asistencia a la bienvenida, medida por ALUMNO.
 *
 * El caso que originó la regla (sep-2026): la bandeja de Welcome contaba como
 * «No asistió» 117 filas, y dentro iban las 36 sesiones que todavía no habían
 * ocurrido y las inasistencias de alumnos que después SÍ asistieron a otra
 * bienvenida.
 */

const AHORA = new Date('2026-09-29T15:00:00.000Z');
const PASADA = '2026-09-25T20:00:00.000Z';
const FUTURA = '2026-10-02T20:00:00.000Z';

test.describe('Estado de una fila de Welcome', () => {
  test('asistió a esta sesión', () => {
    expect(estadoWelcome({ asistencia: true, asistioAlguna: true, fechaEvento: PASADA }, AHORA)).toBe('ASISTIO');
  });

  test('faltó a ésta pero asistió a otra: ya no es inasistente', () => {
    expect(estadoWelcome({ asistencia: false, asistioAlguna: true, fechaEvento: PASADA }, AHORA)).toBe('ASISTIO_OTRA');
  });

  test('faltó y no ha asistido a ninguna', () => {
    expect(estadoWelcome({ asistencia: false, asistioAlguna: false, fechaEvento: PASADA }, AHORA)).toBe('NO_ASISTIO');
  });

  test('la sesión que aún no ocurre es pendiente aunque la asistencia venga en false', () => {
    // El agendamiento nace con asistencia=false: sin mirar la fecha salía «No asistió».
    expect(estadoWelcome({ asistencia: false, asistioAlguna: false, fechaEvento: FUTURA }, AHORA)).toBe('PENDIENTE');
    expect(estadoWelcome({ asistencia: null, asistioAlguna: null, fechaEvento: FUTURA }, AHORA)).toBe('PENDIENTE');
  });

  test('con otra bienvenida asistida, la sesión futura tampoco es pendiente de gestionar', () => {
    expect(estadoWelcome({ asistencia: false, asistioAlguna: true, fechaEvento: FUTURA }, AHORA)).toBe('ASISTIO_OTRA');
  });
});

test.describe('Filtro de asistencia', () => {
  test('«No asistió» deja sólo a quien no ha asistido a ninguna', () => {
    expect(pasaFiltroAsistencia('NO_ASISTIO', 'not-attended')).toBe(true);
    expect(pasaFiltroAsistencia('ASISTIO_OTRA', 'not-attended')).toBe(false);
    expect(pasaFiltroAsistencia('PENDIENTE', 'not-attended')).toBe(false);
    expect(pasaFiltroAsistencia('ASISTIO', 'not-attended')).toBe(false);
  });

  test('«Asistió» lista la sesión a la que sí asistió, no la que perdió antes', () => {
    expect(pasaFiltroAsistencia('ASISTIO', 'attended')).toBe(true);
    expect(pasaFiltroAsistencia('ASISTIO_OTRA', 'attended')).toBe(false);
  });

  test('«Todos» no esconde nada', () => {
    for (const e of ['ASISTIO', 'ASISTIO_OTRA', 'NO_ASISTIO', 'PENDIENTE'] as const) {
      expect(pasaFiltroAsistencia(e, 'all')).toBe(true);
    }
  });
});

test.describe('Búsqueda por nombre, ID o contrato', () => {
  const p = { nombre: 'Emma Peña Herrera', numeroId: '15434727K', contrato: '01-M5-2820-26' };

  test('el texto vacío no filtra', () => {
    expect(coincidePersona(p, '')).toBe(true);
    expect(coincidePersona(p, '   ')).toBe(true);
  });

  test('nombre sin importar acentos ni mayúsculas', () => {
    expect(coincidePersona(p, 'pena')).toBe(true);
    expect(coincidePersona(p, 'EMMA peña')).toBe(true);
    expect(coincidePersona(p, 'lopez')).toBe(false);
  });

  test('documento con o sin puntos y guión', () => {
    expect(coincidePersona(p, '15.434.727-k')).toBe(true);
    expect(coincidePersona(p, '15434727')).toBe(true);
  });

  test('contrato completo o sólo su número', () => {
    expect(coincidePersona(p, '01-M5-2820-26')).toBe(true);
    expect(coincidePersona(p, '2820-26')).toBe(true);
    expect(coincidePersona(p, '2820')).toBe(true);
    expect(coincidePersona(p, '2821')).toBe(false);
  });

  test('sólo signos no coincide con todo', () => {
    expect(coincidePersona(p, '-')).toBe(false);
  });

  test('una fila sin datos no revienta', () => {
    expect(coincidePersona({}, 'emma')).toBe(false);
  });
});
