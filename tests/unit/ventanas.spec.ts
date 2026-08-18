import { test, expect } from '@playwright/test';
import {
  getSessionWindow, ATTENDANCE_WINDOW_MIN, REGISTER_OPEN_MIN, REGISTER_CLOSE_MIN,
} from '../../src/lib/session-window';
import {
  getAdminEventWindow, ADMIN_REGISTER_GRACE_MIN,
} from '../../src/lib/admin-event-window';
import {
  zoomDisponible, ZOOM_ABRE_MIN_ANTES, ZOOM_CIERRA_MIN_DESPUES,
} from '../../src/lib/zoom-window';
import { bookingConRegistroSql } from '../../src/lib/booking-registro';

const INICIO = new Date('2026-08-17T20:00:00.000Z');
/** Instante desplazado `min` minutos respecto del inicio del evento. */
const en = (min: number) => new Date(INICIO.getTime() + min * 60_000);

test.describe('Ventana de la sesión del guía', () => {
  test('antes de empezar no se puede marcar asistencia ni registrar', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(-5));
    expect(w.canMarkAttendance).toBe(false);
    expect(w.canRegister).toBe(false);
    expect(w.isExpired).toBe(false);
  });

  test('al minuto 0 se abre la asistencia, pero el registro todavía no', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(0));
    expect(w.canMarkAttendance).toBe(true);
    expect(w.canRegister).toBe(false);
    expect(w.minutesUntilRegister).toBe(REGISTER_OPEN_MIN);
  });

  test(`el registro abre a los ${REGISTER_OPEN_MIN} minutos exactos`, () => {
    expect(getSessionWindow(INICIO, 'GUIA', en(REGISTER_OPEN_MIN - 1)).canRegister).toBe(false);
    expect(getSessionWindow(INICIO, 'GUIA', en(REGISTER_OPEN_MIN)).canRegister).toBe(true);
  });

  test('en el último minuto de la ventana todavía se puede registrar', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(REGISTER_CLOSE_MIN));
    expect(w.canRegister).toBe(true);
    expect(w.isExpired).toBe(false);
  });

  test('un minuto después expira: ni asistencia ni registro', () => {
    const w = getSessionWindow(INICIO, 'GUIA', en(ATTENDANCE_WINDOW_MIN + 1));
    expect(w.canMarkAttendance).toBe(false);
    expect(w.canRegister).toBe(false);
    expect(w.isExpired).toBe(true);
  });

  test('el coordinador ignora TODAS las ventanas, y para él nunca expira', () => {
    for (const rol of ['COORDINADOR_ACADEMICO', 'SUPER_ADMIN', 'ADMIN']) {
      const w = getSessionWindow(INICIO, rol, en(ATTENDANCE_WINDOW_MIN + 5000));
      expect(w.isCoordinator, rol).toBe(true);
      expect(w.canMarkAttendance, rol).toBe(true);
      expect(w.canRegister, rol).toBe(true);
      expect(w.isExpired, rol).toBe(false);
    }
  });

  test('el rol se compara sin distinguir mayúsculas', () => {
    expect(getSessionWindow(INICIO, 'super_admin', en(0)).isCoordinator).toBe(true);
  });

  test('sin fecha de evento sólo el coordinador puede actuar', () => {
    expect(getSessionWindow(null, 'GUIA').canRegister).toBe(false);
    expect(getSessionWindow(null, 'ADMIN').canRegister).toBe(true);
  });

  test('una fecha ilegible no abre la ventana por accidente', () => {
    const w = getSessionWindow('no-es-una-fecha', 'GUIA', en(60));
    expect(w.canRegister).toBe(false);
    expect(w.canMarkAttendance).toBe(false);
  });
});

test.describe('Ventana del evento administrativo — proporcional a su duración', () => {
  test('un evento de 3 h no se registra a la media hora: hay que esperar a que termine', () => {
    const w = getAdminEventWindow(INICIO, 'GUIA', en(50), 3);
    expect(w.finNominalMin).toBe(180);
    expect(w.canRegister).toBe(false);
    expect(w.minutesUntilRegister).toBe(130);
  });

  test('se abre al terminar el evento y dura la gracia', () => {
    expect(getAdminEventWindow(INICIO, 'GUIA', en(179), 3).canRegister).toBe(false);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(180), 3).canRegister).toBe(true);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(180 + ADMIN_REGISTER_GRACE_MIN), 3).canRegister).toBe(true);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(180 + ADMIN_REGISTER_GRACE_MIN + 1), 3).isExpired).toBe(true);
  });

  test('sin duración se asume 1 hora', () => {
    expect(getAdminEventWindow(INICIO, 'GUIA', en(60)).finNominalMin).toBe(60);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(60), null).canRegister).toBe(true);
  });

  test('el coordinador también aquí pasa por encima', () => {
    expect(getAdminEventWindow(INICIO, 'ADMIN', en(9999), 3).canRegister).toBe(true);
  });
});

test.describe('Acceso a Zoom del alumno', () => {
  test('la ventana es la acordada', () => {
    expect(ZOOM_ABRE_MIN_ANTES).toBe(10);
    expect(ZOOM_CIERRA_MIN_DESPUES).toBe(15);
  });

  test(`abre ${ZOOM_ABRE_MIN_ANTES} minutos antes, ni uno más`, () => {
    expect(zoomDisponible(INICIO.getTime(), en(-11).getTime())).toBe(false);
    expect(zoomDisponible(INICIO.getTime(), en(-10).getTime())).toBe(true);
  });

  test('sigue abierto a la hora y hasta el cierre', () => {
    expect(zoomDisponible(INICIO.getTime(), en(0).getTime())).toBe(true);
    expect(zoomDisponible(INICIO.getTime(), en(15).getTime())).toBe(true);
    expect(zoomDisponible(INICIO.getTime(), en(16).getTime())).toBe(false);
  });

  test('se compara el INSTANTE: dos alumnos en husos distintos lo ven abrirse a la vez', () => {
    // Un mismo instante, mirado como Date, no depende de la zona del cliente.
    const instante = en(-10).getTime();
    expect(zoomDisponible(INICIO.getTime(), instante)).toBe(true);
    expect(zoomDisponible(INICIO.getTime(), instante - 1)).toBe(false);
  });
});

test.describe('Qué agendamiento guarda historia (y por tanto no se puede borrar)', () => {
  const sql = bookingConRegistroSql('b');

  test('y también el texto escrito a mano por el guía', () => {
    // La versión amplia venía del script de limpieza de huérfanos: una anotación
    // o un comentario tampoco se reconstruyen, así que también impiden el borrado.
    expect(sql).toContain('advisorAnotaciones');
    expect(sql).toContain('comentarios');
  });

  test('cuenta asistencia, participación, no-aprobó, cancelación y calificación', () => {
    for (const campo of ['asistio', 'asistencia', 'participacion', 'noAprobo', 'cancelo', 'calificacion']) {
      expect(sql, campo).toContain(`"${campo}"`);
    }
  });

  test('respeta el alias que se le pase', () => {
    expect(bookingConRegistroSql('bk')).toContain('bk."asistio"');
    expect(bookingConRegistroSql('bk')).not.toContain('b."asistio"');
  });

  test('viene envuelto en paréntesis para poder concatenarlo con AND', () => {
    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
  });
});
