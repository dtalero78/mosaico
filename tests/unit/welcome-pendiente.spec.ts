import { test, expect } from '@playwright/test';
import { motivoWelcomePendiente, etiquetaMotivoWelcomePendiente } from '../../src/lib/welcome-pendiente';

/**
 * Bienvenida pendiente de agendar (13-oct-2026): por qué quedó el perfil sin
 * bienvenida. Lo que el alumno decidió manda sobre lo que pasó.
 */

test.describe('Motivo de bienvenida pendiente', () => {
  test('la casilla del alumno manda sobre todo lo demás', () => {
    expect(motivoWelcomePendiente({ omitirWelcome: true, soloPerfil: true, eligioSesion: true })).toBe('SOLICITUD_USUARIO');
    expect(motivoWelcomePendiente({ omitirWelcome: true, soloPerfil: false, eligioSesion: false })).toBe('SOLICITUD_USUARIO');
  });
  test('el enlace de sólo perfil va después de la casilla', () => {
    expect(motivoWelcomePendiente({ omitirWelcome: false, soloPerfil: true, eligioSesion: false })).toBe('SOLO_PERFIL');
  });
  test('eligió sesión pero no quedó agendada vs no había sesiones', () => {
    expect(motivoWelcomePendiente({ omitirWelcome: false, soloPerfil: false, eligioSesion: true })).toBe('NO_AGENDADO');
    expect(motivoWelcomePendiente({ omitirWelcome: false, soloPerfil: false, eligioSesion: false })).toBe('SIN_SESIONES');
  });
  test('sin motivo guardado (perfiles anteriores) tiene su propia etiqueta', () => {
    expect(etiquetaMotivoWelcomePendiente(null)).toBe('Sin registro de motivo');
    expect(etiquetaMotivoWelcomePendiente('INVENTADO')).toBe('Sin registro de motivo');
    expect(etiquetaMotivoWelcomePendiente('SOLICITUD_USUARIO')).toBe('Lo pidió el usuario');
  });
});
