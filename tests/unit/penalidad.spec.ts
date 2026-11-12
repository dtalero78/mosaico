import { test, expect } from '@playwright/test';
import { valorPenalidad, armarPlan, aplicarPagoPlan, sumarMeses, planCompleto, siguienteCuota, pendientePlan } from '../../src/lib/penalidad';

test('el 30% del saldo se redondea al peso', () => {
  expect(valorPenalidad(920000)).toBe(276000);
  expect(valorPenalidad(1000001)).toBe(300000);
  expect(valorPenalidad(-5)).toBe(0);
});

test('el plan reparte en partes iguales y la última absorbe el redondeo', () => {
  const p = armarPlan(276001, 3, '2026-11-11');
  expect(p.map(c => c.valor)).toEqual([92000, 92000, 92001]);
  expect(p.reduce((s, c) => s + c.valor, 0)).toBe(276001);
  expect(p.map(c => c.fecha)).toEqual(['2026-11-11', '2026-12-11', '2027-01-11']);
});

test('sumarMeses cae al último día si el mes no tiene el día', () => {
  expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
  expect(sumarMeses('2026-11-30', 3)).toBe('2027-02-28');
  expect(sumarMeses('2026-12-15', 1)).toBe('2027-01-15');
});

test('los pagos se aplican en orden, permiten adelantar y marcan las cuotas', () => {
  let plan = armarPlan(300000, 3, '2026-11-01');
  let r = aplicarPagoPlan(plan, 150000); // cuota 1 completa + mitad de la 2
  expect(r.cuotas.map(c => c.pagado)).toEqual([100000, 50000, 0]);
  expect(siguienteCuota(r.cuotas)?.n).toBe(2);
  r = aplicarPagoPlan(r.cuotas, 150000);
  expect(planCompleto(r.cuotas)).toBe(true);
  expect(pendientePlan(r.cuotas)).toBe(0);
});

test('un pago mayor a lo pendiente deja sobrante', () => {
  const plan = armarPlan(100000, 2, '2026-11-01');
  const r = aplicarPagoPlan(plan, 120000);
  expect(r.sobrante).toBe(20000);
  expect(planCompleto(r.cuotas)).toBe(true);
});
