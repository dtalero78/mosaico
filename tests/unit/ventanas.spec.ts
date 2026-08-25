import { test, expect } from '@playwright/test';
import {
  getSessionWindow, ATTENDANCE_WINDOW_MIN, REGISTER_OPEN_MIN, REGISTER_CLOSE_MIN,
} from '../../src/lib/session-window';
import {
  getAdminEventWindow,
} from '../../src/lib/admin-event-window';
import {
  zoomDisponible, estadoZoom, proximoCambioZoom, dentroVentanaIngreso,
  ZOOM_ABRE_MIN_ANTES, ZOOM_CIERRA_MIN_DESPUES, ZOOM_RECONEXION_MARGEN_FINAL_MIN,
} from '../../src/lib/zoom-window';
import { bookingConRegistroSql } from '../../src/lib/booking-registro';

const INICIO = new Date('2026-08-17T20:00:00.000Z');
/** Instante desplazado `min` minutos respecto del inicio del evento. */
const en = (min: number) => new Date(INICIO.getTime() + min * 60_000);

test.describe('Ventana de la sesión del guía', () => {
  test('la ventana es la acordada: 24 h, con el registro abriendo a los 30 min', () => {
    // Fijado a propósito. El resto de tests usa las constantes, así que pasarían
    // con cualquier valor; éste obliga a que cambiar la ventana sea una decisión
    // explícita y no un descuido.
    expect(ATTENDANCE_WINDOW_MIN).toBe(1440);
    expect(REGISTER_CLOSE_MIN).toBe(1440);
    expect(REGISTER_OPEN_MIN).toBe(30);
  });

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

test.describe('Ventana del evento administrativo — las mismas reglas que una sesión', () => {
  test('no se registra antes de los 30 min, aunque el evento dure 3 h', () => {
    const w = getAdminEventWindow(INICIO, 'GUIA', en(20), 3);
    expect(w.canRegister).toBe(false);
    expect(w.minutesUntilRegister).toBe(10);
  });

  test('abre a los 30 min del INICIO — no hay que esperar a que termine', () => {
    expect(getAdminEventWindow(INICIO, 'GUIA', en(29), 3).canRegister).toBe(false);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(30), 3).canRegister).toBe(true);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(REGISTER_CLOSE_MIN), 3).canRegister).toBe(true);
    expect(getAdminEventWindow(INICIO, 'GUIA', en(REGISTER_CLOSE_MIN + 1), 3).isExpired).toBe(true);
  });

  test('la ventana es la MISMA que la de las sesiones', () => {
    for (const horas of [1, 3, 8]) {
      const w = getAdminEventWindow(INICIO, 'GUIA', en(REGISTER_OPEN_MIN), horas);
      expect(w.canRegister).toBe(true);   // no depende de la duración
    }
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
  const T = INICIO.getTime();
  /** Sin acceso registrado: sólo tiene la ventana de ingreso. */
  const sinAcceso = (min: number, tipo?: string, horario?: string) =>
    estadoZoom(T, tipo ?? null, horario ?? null, null, en(min).getTime());
  /** Entró a los -2 min: le corre además la reconexión. */
  const conAcceso = (min: number, tipo?: string, horario?: string) =>
    estadoZoom(T, tipo ?? null, horario ?? null, en(-2).getTime(), en(min).getTime());

  test('la ventana es la acordada', () => {
    // Fijadas a propósito: el resto de tests usa las constantes y pasarían con
    // cualquier valor. Cambiar la ventana debe ser una decisión, no un descuido.
    expect(ZOOM_ABRE_MIN_ANTES).toBe(5);
    expect(ZOOM_CIERRA_MIN_DESPUES).toBe(10);
    expect(ZOOM_RECONEXION_MARGEN_FINAL_MIN).toBe(10);
  });

  test(`abre ${ZOOM_ABRE_MIN_ANTES} minutos antes, ni uno más`, () => {
    expect(sinAcceso(-(ZOOM_ABRE_MIN_ANTES + 1))).toBe('espera');
    expect(sinAcceso(-ZOOM_ABRE_MIN_ANTES)).toBe('disponible');
  });

  test('sigue abierto a la hora y hasta el cierre del plazo', () => {
    expect(sinAcceso(0)).toBe('disponible');
    expect(sinAcceso(ZOOM_CIERRA_MIN_DESPUES)).toBe('disponible');
  });

  test('quien NO entró a tiempo pierde el acceso: el plazo venció', () => {
    expect(sinAcceso(ZOOM_CIERRA_MIN_DESPUES + 1)).toBe('vencido');
    expect(sinAcceso(45)).toBe('vencido');
  });

  test('quien SÍ entró conserva el ícono hasta 10 min antes del final', () => {
    // Sesión de 1 h: la reconexión llega hasta el minuto 50.
    expect(conAcceso(16)).toBe('disponible');
    expect(conAcceso(50)).toBe('disponible');
    expect(conAcceso(51)).toBe('cerrado');
  });

  test('el cierre sale de la DURACIÓN, no de un número fijo', () => {
    // Bloque de IMPULSA (2h30) → hasta el minuto 140.
    expect(conAcceso(139, 'ENTRENAMIENTO')).toBe('disponible');
    expect(conAcceso(141, 'ENTRENAMIENTO')).toBe('cerrado');
    // Nivelación (30 min) → 20 min... pero el plazo de ingreso llega a 15 y la
    // reconexión nunca puede acortarlo.
    expect(conAcceso(20, 'NIVELACION')).toBe('disponible');
    expect(conAcceso(21, 'NIVELACION')).toBe('cerrado');
    // Manda el horario del curso sobre el tipo: 50 min → hasta el minuto 40.
    expect(conAcceso(40, 'SESSION', 'MAR-JUE 19:00-19:50')).toBe('disponible');
    expect(conAcceso(41, 'SESSION', 'MAR-JUE 19:00-19:50')).toBe('cerrado');
  });

  test('la reconexión nunca acorta el plazo de ingreso', () => {
    // Una clase tan corta que `duración − 10` caería antes del cierre normal:
    // el alumno conserva sus 15 minutos igual.
    expect(conAcceso(15, 'NIVELACION')).toBe('disponible');
  });

  test('entrar tarde también da reconexión: cuenta haber entrado, no cuándo', () => {
    // Entró al minuto 14, dentro del plazo. Le corre igual hasta el 50.
    expect(estadoZoom(T, null, null, en(14).getTime(), en(49).getTime())).toBe('disponible');
  });

  test('el servidor sólo admite generar el acceso dentro del plazo', () => {
    expect(dentroVentanaIngreso(T, en(-(ZOOM_ABRE_MIN_ANTES + 1)).getTime())).toBe(false);
    expect(dentroVentanaIngreso(T, en(-ZOOM_ABRE_MIN_ANTES).getTime())).toBe(true);
    expect(dentroVentanaIngreso(T, en(ZOOM_CIERRA_MIN_DESPUES).getTime())).toBe(true);
    expect(dentroVentanaIngreso(T, en(ZOOM_CIERRA_MIN_DESPUES + 1).getTime())).toBe(false);
  });

  test('el temporizador apunta al instante correcto y termina', () => {
    // Sin acceso: abre → cierra el plazo → nada más.
    expect(proximoCambioZoom(T, null, null, null, en(-30).getTime())).toBe(en(-ZOOM_ABRE_MIN_ANTES).getTime());
    expect(proximoCambioZoom(T, null, null, null, en(0).getTime())).toBe(en(ZOOM_CIERRA_MIN_DESPUES).getTime());
    expect(proximoCambioZoom(T, null, null, null, en(20).getTime())).toBeNull();
    // Con acceso: el siguiente corte es el fin de la reconexión, no el del plazo.
    expect(proximoCambioZoom(T, null, null, en(-2).getTime(), en(0).getTime())).toBe(en(50).getTime());
    expect(proximoCambioZoom(T, null, null, en(-2).getTime(), en(60).getTime())).toBeNull();
  });

  test('se compara el INSTANTE: dos alumnos en husos distintos lo ven abrirse a la vez', () => {
    // Un mismo instante, mirado como Date, no depende de la zona del cliente.
    const instante = en(-ZOOM_ABRE_MIN_ANTES).getTime();
    expect(zoomDisponible(T, null, null, null, instante)).toBe(true);
    expect(zoomDisponible(T, null, null, null, instante - 1)).toBe(false);
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
