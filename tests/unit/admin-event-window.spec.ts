import { test, expect } from '@playwright/test'
import {
  getAdminEventWindow, horaLocal, minutosDelDia, esTzValida,
} from '../../src/lib/admin-event-window'

/**
 * Reunión real del caso reportado: `2026-08-28T20:00:00Z`, 1 hora.
 * Son las 16:00 en Chile y las 15:00 en Colombia — nunca las 20:00, que es lo
 * que leía el servidor (corre en UTC) y por lo que rechazaba todo Time Out.
 */
const REUNION = '2026-08-28T20:00:00.000Z'

test('la hora del evento se lee en la zona del guia, no en la del proceso', () => {
  expect(horaLocal(REUNION, 'America/Santiago')).toBe('16:00')
  expect(horaLocal(REUNION, 'America/Bogota')).toBe('15:00')
  expect(horaLocal(REUNION, 'UTC')).toBe('20:00')
})

test('una zona inexistente o basura cae a la del proceso, sin romperse', () => {
  // 'America/Atlantis' pasa el regex de forma pero Intl no la conoce.
  expect(horaLocal(REUNION, 'America/Atlantis')).toMatch(/^\d{2}:\d{2}$/)
  expect(horaLocal(REUNION, 'no-es-una-zona')).toMatch(/^\d{2}:\d{2}$/)
  expect(horaLocal(REUNION, null)).toMatch(/^\d{2}:\d{2}$/)
  expect(horaLocal('fecha basura', 'UTC')).toBe('')
})

test('el Time Out del guia ya no queda por debajo del inicio', () => {
  // Colombia: la reunión empieza 15:00 y el guía cierra 17:00 → válido.
  const inicioCO = horaLocal(REUNION, 'America/Bogota')
  expect(minutosDelDia('17:00') >= minutosDelDia(inicioCO)).toBe(true)
  // Con la lectura vieja (UTC) el mismo Time Out se rechazaba.
  expect(minutosDelDia('17:00') >= minutosDelDia(horaLocal(REUNION, 'UTC'))).toBe(false)
})

test('un Time Out realmente anterior al inicio se sigue rechazando', () => {
  const inicioCL = horaLocal(REUNION, 'America/Santiago')  // 16:00
  expect(minutosDelDia('15:30') >= minutosDelDia(inicioCL)).toBe(false)
  expect(minutosDelDia('16:00') >= minutosDelDia(inicioCL)).toBe(true)
})

test('zonas IANA validas e invalidas', () => {
  expect(esTzValida('America/Santiago')).toBe(true)
  expect(esTzValida('Europe/Madrid')).toBe(true)
  expect(esTzValida('UTC')).toBe(true)           // un navegador la puede reportar así
  expect(esTzValida('America/Argentina/Buenos_Aires')).toBe(true)
  expect(esTzValida('; DROP TABLE')).toBe(false)
  expect(esTzValida(null)).toBe(false)
})

test('el plazo de registro llega a 24 h DESPUES de que el evento termina', () => {
  const inicio = new Date(REUNION)
  const enMin = (m: number) => new Date(inicio.getTime() + m * 60_000)
  const w = (m: number, horas = 1) => getAdminEventWindow(inicio, 'ADVISOR', enMin(m), horas)

  // Evento de 1 h: cierra a las 24 h del FIN, o sea +25 h del inicio.
  expect(w(29).canRegister).toBe(false)          // aún no abre (+30 min)
  expect(w(30).canRegister).toBe(true)
  expect(w(24 * 60).canRegister).toBe(true)      // 24 h después del inicio
  expect(w(25 * 60).canRegister).toBe(true)      // 24 h justas tras el fin
  expect(w(25 * 60 + 1).canRegister).toBe(false)
  expect(w(25 * 60 + 1).isExpired).toBe(true)
})

test('un evento largo conserva sus 24 h completas tras terminar', () => {
  const inicio = new Date(REUNION)
  const w = (m: number, horas: number) =>
    getAdminEventWindow(inicio, 'ADVISOR', new Date(inicio.getTime() + m * 60_000), horas)
  // Evento de 3 h: el plazo corre hasta +27 h del inicio, no +24.
  expect(w(26 * 60, 3).canRegister).toBe(true)
  expect(w(27 * 60, 3).canRegister).toBe(true)
  expect(w(27 * 60 + 1, 3).canRegister).toBe(false)
})

test('el coordinador sigue sin ventana', () => {
  const inicio = new Date(REUNION)
  const tarde = new Date(inicio.getTime() + 90 * 60 * 60_000)  // 90 h después
  expect(getAdminEventWindow(inicio, 'COORDINADOR_ACADEMICO', tarde, 1).canRegister).toBe(true)
  expect(getAdminEventWindow(inicio, 'ADVISOR', tarde, 1).canRegister).toBe(false)
})
