import { test, expect } from '@playwright/test';
import { agendamientoSeCruza, eventEndDate } from '@/lib/event-duration';

/**
 * Cuándo un taller se cruza con una clase que el alumno ya tiene.
 *
 * El caso que originó la regla (sep-2026): el taller de apoderados del miércoles
 * 30-sep a las 19:30 (Chile). El selector pintaba el día, pero a los alumnos con
 * clase a esa hora la lista les salía vacía, y a los de 19:15 y 20:00 se les
 * rechazaba recién al confirmar. La lista marca ahora el cruce con la MISMA
 * cuenta con la que después se rechaza el agendamiento.
 */

// 19:30 de Chile (UTC-3) = 22:30Z
const TALLER = new Date('2026-09-30T22:30:00.000Z');
const FIN = eventEndDate(TALLER, 'CLUB');
const a = (horaChile: string) => new Date(`2026-09-30T${horaChile}:00.000-03:00`);

test.describe('Cruce de un taller con la clase del alumno', () => {
  test('el taller dura una hora', () => {
    expect(FIN.toISOString()).toBe('2026-09-30T23:30:00.000Z');
  });

  test('la clase a la misma hora exacta se cruza', () => {
    expect(agendamientoSeCruza(TALLER, FIN, a('19:30'), 'SESSION')).toBe(true);
  });

  test('la clase que empezó antes y sigue en curso se cruza', () => {
    // DANSHI LUN-MIÉ 19:15-20:05
    expect(agendamientoSeCruza(TALLER, FIN, a('19:15'), 'SESSION')).toBe(true);
  });

  test('la clase que empieza a mitad del taller se cruza', () => {
    // SENPAI LUN-MIÉ 20:00-20:50
    expect(agendamientoSeCruza(TALLER, FIN, a('20:00'), 'SESSION')).toBe(true);
  });

  test('terminar justo cuando el taller empieza NO es cruce', () => {
    expect(agendamientoSeCruza(TALLER, FIN, a('18:30'), 'SESSION')).toBe(false);
  });

  test('empezar justo cuando el taller termina NO es cruce', () => {
    expect(agendamientoSeCruza(TALLER, FIN, a('20:30'), 'SESSION')).toBe(false);
  });

  test('las clases de la tarde no se cruzan', () => {
    expect(agendamientoSeCruza(TALLER, FIN, a('17:00'), 'SESSION')).toBe(false);
    // OKINA LUN-MIÉ 18:15-19:15
    expect(agendamientoSeCruza(TALLER, FIN, a('18:15'), 'SESSION')).toBe(false);
  });

  test('la nivelación ocupa media hora, no una', () => {
    expect(agendamientoSeCruza(TALLER, FIN, a('19:00'), 'NIVELACION')).toBe(false);
    expect(agendamientoSeCruza(TALLER, FIN, a('19:00'), 'SESSION')).toBe(true);
    expect(agendamientoSeCruza(TALLER, FIN, a('19:15'), 'nivelacion')).toBe(true);
  });

  test('sin tipo se asume una hora', () => {
    expect(agendamientoSeCruza(TALLER, FIN, a('18:45'), null)).toBe(true);
    expect(agendamientoSeCruza(TALLER, FIN, a('18:30'), undefined)).toBe(false);
  });
});
