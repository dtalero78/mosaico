import { test, expect } from '@playwright/test';
import { getSessionWindow, ATTENDANCE_WINDOW_MIN, REGISTER_CLOSE_MIN } from '../../src/lib/session-window';
import { getAdminEventWindow } from '../../src/lib/admin-event-window';
import { guiaPuedeGestionar } from '../../src/lib/reporte-academico-ventana';
import {
  refReporte, reporteRefValida, esTipoAutorizacion,
  sesionVencida, eventoAdminVencido, reporteVencido,
} from '../../src/lib/autorizacion-gestion';

/**
 * Columna "Autoriza" de Procesos sin gestión: Coordinación reabre al guía lo que
 * ya se le venció. Estas pruebas fijan lo que se confunde: que la autorización
 * SÓLO reabra lo vencido, que no toque al coordinador, y que el informe de una
 * semana terminada ya no se gestione "cualquier día" sino con autorización.
 */

const INICIO = new Date('2026-08-17T20:00:00.000Z');
const en = (min: number) => new Date(INICIO.getTime() + min * 60_000);

test.describe('Autorización en la ventana de la sesión', () => {
  test('vencida y autorizada: el guía vuelve a poder marcar asistencia y registrar', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(ATTENDANCE_WINDOW_MIN + 60 * 24 * 5), true);
    expect(w.canMarkAttendance).toBe(true);
    expect(w.canRegister).toBe(true);
    expect(w.isExpired).toBe(false);
    expect(w.porAutorizacion).toBe(true);
  });

  test('vencida sin autorización: sigue vencida', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(ATTENDANCE_WINDOW_MIN + 1), false);
    expect(w.canRegister).toBe(false);
    expect(w.isExpired).toBe(true);
    expect(w.porAutorizacion).toBe(false);
  });

  test('dentro del plazo la autorización no cambia nada (no hace falta)', () => {
    const con = getSessionWindow(INICIO, 'GUIA', en(60), true);
    const sin = getSessionWindow(INICIO, 'GUIA', en(60), false);
    expect(con.porAutorizacion).toBe(false);
    expect(con.canRegister).toBe(sin.canRegister);
    expect(con.canMarkAttendance).toBe(sin.canMarkAttendance);
  });

  test('antes de empezar tampoco abre nada: no hay qué autorizar', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(-30), true);
    expect(w.canMarkAttendance).toBe(false);
    expect(w.porAutorizacion).toBe(false);
  });

  test('al coordinador no le aplica: su cierre sigue siendo gestión suya', () => {
    const w = getSessionWindow(INICIO, 'COORDINADOR_ACADEMICO', en(ATTENDANCE_WINDOW_MIN + 500), true);
    expect(w.isCoordinator).toBe(true);
    expect(w.porAutorizacion).toBe(false);
  });
});

test.describe('Autorización en el evento administrativo', () => {
  const fin3h = 180;
  test('vencido y autorizado: se puede registrar', () => {
    const w = getAdminEventWindow(INICIO, 'GUIA', en(fin3h + REGISTER_CLOSE_MIN + 1), 3, true);
    expect(w.canRegister).toBe(true);
    expect(w.isExpired).toBe(false);
    expect(w.porAutorizacion).toBe(true);
  });
  test('vencido sin autorización: sigue vencido', () => {
    const w = getAdminEventWindow(INICIO, 'GUIA', en(fin3h + REGISTER_CLOSE_MIN + 1), 3);
    expect(w.canRegister).toBe(false);
    expect(w.isExpired).toBe(true);
  });
  test('en plazo la autorización no cambia nada', () => {
    expect(getAdminEventWindow(INICIO, 'GUIA', en(60), 3, true).porAutorizacion).toBe(false);
  });
});

test.describe('Autorización en el Reporte Académico', () => {
  // Martes 29-sep-2026 al mediodía de Chile: semana en curso = la del 28.
  const martes = new Date('2026-09-29T15:00:00.000Z');
  const miercoles = new Date('2026-09-30T15:00:00.000Z');

  test('una semana YA terminada sólo se gestiona con autorización (reemplaza la regla del 29-sep)', () => {
    expect(guiaPuedeGestionar('2026-09-21', martes)).toBe(false);
    expect(guiaPuedeGestionar('2026-09-21', martes, true)).toBe(true);
    expect(guiaPuedeGestionar('2026-09-21', miercoles)).toBe(false); // el miércoles tampoco: la ventana era SU semana
  });

  test('la semana en curso conserva miércoles–domingo, con o sin autorización', () => {
    expect(guiaPuedeGestionar('2026-09-28', martes, true)).toBe(false);
    expect(guiaPuedeGestionar('2026-09-28', miercoles, false)).toBe(true);
  });
});

test.describe('Qué está vencido para el guía (una sola regla para las tres pestañas)', () => {
  const ahora = new Date('2026-09-30T15:00:00.000Z');
  test('sesión: a las 24 h del inicio', () => {
    expect(sesionVencida(new Date(ahora.getTime() - 23 * 3600_000), ahora)).toBe(false);
    expect(sesionVencida(new Date(ahora.getTime() - 25 * 3600_000), ahora)).toBe(true);
  });
  test('evento administrativo: 24 h después de su FIN (dura horas)', () => {
    const hace30h = new Date(ahora.getTime() - 30 * 3600_000);
    expect(eventoAdminVencido(hace30h, 1, ahora)).toBe(true);   // fin hace 29 h
    expect(eventoAdminVencido(hace30h, 8, ahora)).toBe(false);  // fin hace 22 h
  });
  test('informe: cuando su semana ya terminó (en Chile)', () => {
    expect(reporteVencido('2026-09-21', ahora)).toBe(true);
    expect(reporteVencido('2026-09-28', ahora)).toBe(false);
  });
});

test.describe('Llave del informe', () => {
  test('se arma con campaña, curso, salón y el lunes de la semana', () => {
    expect(refReporte({ campaign: 'ENERO262026M', curso: 'DANSHI', salon: '06', semanaInicio: '2026-09-21' }))
      .toBe('ENERO262026M|DANSHI|06|2026-09-21');
    // Con hora o espacios de más llega a la misma llave.
    expect(refReporte({ campaign: ' ENERO262026M ', curso: 'DANSHI', salon: '06', semanaInicio: '2026-09-21T00:00:00.000Z' }))
      .toBe('ENERO262026M|DANSHI|06|2026-09-21');
  });
  test('una cuaterna incompleta o con el separador dentro no es válida', () => {
    expect(reporteRefValida({ campaign: 'A', curso: 'B', salon: '01', semanaInicio: '2026-09-21' })).toBe(true);
    expect(reporteRefValida({ campaign: '', curso: 'B', salon: '01', semanaInicio: '2026-09-21' })).toBe(false);
    expect(reporteRefValida({ campaign: 'A', curso: 'B', salon: '01', semanaInicio: 'ayer' })).toBe(false);
    expect(reporteRefValida({ campaign: 'A|B', curso: 'B', salon: '01', semanaInicio: '2026-09-21' })).toBe(false);
    expect(reporteRefValida(null)).toBe(false);
  });
  test('sólo los tres tipos conocidos', () => {
    expect(esTipoAutorizacion('SESION')).toBe(true);
    expect(esTipoAutorizacion('EVENTO_ADMIN')).toBe(true);
    expect(esTipoAutorizacion('REPORTE')).toBe(true);
    expect(esTipoAutorizacion('sesion')).toBe(false);
    expect(esTipoAutorizacion(undefined)).toBe(false);
  });
});
