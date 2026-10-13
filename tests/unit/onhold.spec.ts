import { test, expect } from '@playwright/test';
import { diasAExtenderOnHold, sumarDiasISO, fechaISO, diasEntre } from '../../src/lib/onhold';

/**
 * Días que se devuelven al contrato al salir del OnHold (13-oct-2026): los que el
 * alumno REALMENTE estuvo pausado, nunca más que el período programado.
 */

test.describe('Días a extender al salir del OnHold', () => {
  test('al vencer, el período programado completo (caso real: 5-ago → 5-oct = 61)', () => {
    expect(diasAExtenderOnHold('2026-08-05', '2026-10-05', '2026-10-05')).toBe(61);
  });
  test('reactivado tarde (el cron no corrió) no suma más que lo programado', () => {
    expect(diasAExtenderOnHold('2026-08-05', '2026-10-05', '2026-10-20')).toBe(61);
  });
  test('desbloqueo adelantado: sólo los días hasta hoy', () => {
    expect(diasAExtenderOnHold('2026-09-01', '2026-11-30', '2026-09-11')).toBe(10);
  });
  test('la pausa todavía no empezaba: 0 días', () => {
    expect(diasAExtenderOnHold('2026-11-01', '2026-11-30', '2026-10-13')).toBe(0);
  });
  test('cruza de año y de mes sin correrse un día', () => {
    expect(diasAExtenderOnHold('2026-12-20', '2027-01-10', '2027-01-10')).toBe(21);
    expect(sumarDiasISO('2027-07-18', 61)).toBe('2027-09-17');
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
  });
  test('fechaISO acepta texto o Date y rechaza basura', () => {
    expect(fechaISO('2026-10-05')).toBe('2026-10-05');
    expect(fechaISO(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
    expect(fechaISO('Wed Aug 05')).toBeNull();
    expect(fechaISO(null)).toBeNull();
  });
});
