import { test, expect } from '@playwright/test';
import {
  MAX_WELCOME_AGENDAMIENTOS, puedeAgendarOtroWelcome, esEventoWelcome,
  mensajeVideoWelcome, telefonoApoderado, mensajeTopeWelcome,
} from '../../src/lib/welcome-intentos';

/**
 * Tope de 2 bienvenidas y el mensaje del video (30-sep-2026).
 */

test.describe('Tope de sesiones de bienvenida', () => {
  test('el tope es 2: con 0 o 1 se puede agendar otra; con 2 o más, no', () => {
    expect(MAX_WELCOME_AGENDAMIENTOS).toBe(2);
    expect(puedeAgendarOtroWelcome(0)).toBe(true);
    expect(puedeAgendarOtroWelcome(1)).toBe(true);
    expect(puedeAgendarOtroWelcome(2)).toBe(false);
    expect(puedeAgendarOtroWelcome(3)).toBe(false);
  });
  test('el mensaje del rechazo nombra al alumno y dice qué hacer', () => {
    const m = mensajeTopeWelcome('ANA PEREZ');
    expect(m).toContain('ANA PEREZ');
    expect(m).toContain('Video Welcome');
  });
});

test.describe('¿Es un evento de bienvenida?', () => {
  test('lo reconoce por tipo, evento, nivel o título', () => {
    expect(esEventoWelcome({ tipo: 'WELCOME' })).toBe(true);
    expect(esEventoWelcome({ tipo: 'SESSION', nivel: 'WELCOME' })).toBe(true);
    expect(esEventoWelcome({ tipo: 'SESSION', tituloONivel: 'WELCOME - MOSAICO - Leccion 00' })).toBe(true);
    expect(esEventoWelcome({ tipo: 'welcome' })).toBe(true);
  });
  test('una sesión de curso no lo es', () => {
    expect(esEventoWelcome({ tipo: 'SESSION', nivel: 'Modulo 01', tituloONivel: 'YOJI - 01' })).toBe(false);
    expect(esEventoWelcome(null)).toBe(false);
  });
});

test.describe('Mensaje del video (va al apoderado)', () => {
  const m = mensajeVideoWelcome({
    apoderado: 'María Soto', alumno: 'Tomás Pérez',
    enlaceVideo: 'https://x.test/video-welcome', enlacePlataforma: 'https://x.test/',
  });
  test('saluda al apoderado por su nombre y nombra al alumno', () => {
    expect(m.startsWith('Estimado/a María Soto, buenas tardes 😊')).toBe(true);
    expect(m).toContain('el usuario Tomás Pérez');
  });
  test('lleva el enlace del video y el de la plataforma', () => {
    expect(m).toContain('https://x.test/video-welcome');
    expect(m).toContain('🌐 https://x.test/');
    expect(m).toContain('10 días antes del inicio de sus clases');
  });
  test('sin nombre de apoderado no queda un hueco', () => {
    expect(mensajeVideoWelcome({ enlaceVideo: 'v', enlacePlataforma: 'p' }).startsWith('Estimado/a, buenas tardes')).toBe(true);
  });
  test('teléfono del apoderado: sólo dígitos, y vacío si no alcanza', () => {
    expect(telefonoApoderado('+56 9 8765 4321')).toBe('56987654321');
    expect(telefonoApoderado('98765432')).toBe('');
    expect(telefonoApoderado(null)).toBe('');
  });
});
