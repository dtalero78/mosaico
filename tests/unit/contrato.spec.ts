import { test, expect } from '@playwright/test';
import { isContractExpired, CONTRACT_EXPIRED_SQL } from '../../src/lib/contract-expiry';
import { estadoContratoTitular, ESTADO_EN_GESTION, ESTADO_PENDIENTE } from '../../src/lib/estado-contrato';
import { ESTADOS_LIBERAN_CUPO, cupoOcupadoSql, estadoContratoDisplay } from '../../src/lib/cupo';

/** Fecha UTC de hoy desplazada `d` días, en YYYY-MM-DD. */
function hoyUtcMas(d: number): string {
  const n = new Date();
  n.setUTCDate(n.getUTCDate() + d);
  return n.toISOString().slice(0, 10);
}

test.describe('Contrato vencido — un día de gracia para cualquier zona horaria', () => {
  test('el último día del contrato NO está vencido', () => {
    expect(isContractExpired(hoyUtcMas(0))).toBe(false);
  });

  test('el día siguiente tampoco: es el día de gracia', () => {
    // La gracia existe para que a nadie se le corte el acceso mientras en su
    // reloj todavía es el último día. Chile, Colombia, España o Australia.
    expect(isContractExpired(hoyUtcMas(-1))).toBe(false);
  });

  test('dos días después SÍ está vencido', () => {
    expect(isContractExpired(hoyUtcMas(-2))).toBe(true);
  });

  test('un contrato futuro nunca está vencido', () => {
    expect(isContractExpired(hoyUtcMas(30))).toBe(false);
  });

  test('sin fecha no se bloquea a nadie', () => {
    expect(isContractExpired(null)).toBe(false);
    expect(isContractExpired(undefined)).toBe(false);
    expect(isContractExpired('')).toBe(false);
  });

  test('acepta Date además de texto y da el mismo veredicto', () => {
    const d = new Date(hoyUtcMas(-2) + 'T00:00:00Z');
    expect(isContractExpired(d)).toBe(isContractExpired(hoyUtcMas(-2)));
  });

  test('el SQL usa la MISMA gracia que la función', () => {
    // Si alguien cambia GRACE_DAYS, las dos ramas deben moverse juntas: el cron
    // filtra en SQL y el panel decide en JS. Divergir = usuarios bloqueados en
    // una vía y activos en la otra.
    expect(CONTRACT_EXPIRED_SQL('"finalContrato"')).toContain("INTERVAL '1 day'");
    expect(CONTRACT_EXPIRED_SQL('"finalContrato"')).toContain('IS NOT NULL');
  });
});

test.describe('Estado visible del titular — En Gestión vs Pendiente', () => {
  test('sin decidir y sin dejar listo: En Gestión (el cupo aún no está reservado)', () => {
    expect(estadoContratoTitular(null, false)).toBe(ESTADO_EN_GESTION);
    expect(estadoContratoTitular('', false)).toBe(ESTADO_EN_GESTION);
    expect(estadoContratoTitular('Pendiente', false)).toBe(ESTADO_EN_GESTION);
    expect(estadoContratoTitular('  pendiente  ', null)).toBe(ESTADO_EN_GESTION);
  });

  test('sin decidir pero ya listo: Pendiente de aprobación', () => {
    expect(estadoContratoTitular(null, true)).toBe(ESTADO_PENDIENTE);
    expect(estadoContratoTitular('Pendiente', true)).toBe(ESTADO_PENDIENTE);
  });

  test('los estados YA decididos se muestran tal cual, listo o no', () => {
    for (const e of ['Aprobado', 'Devuelto', 'Rechazado', 'Retractado', 'Contrato nulo', 'FINALIZADA']) {
      expect(estadoContratoTitular(e, false)).toBe(e);
      expect(estadoContratoTitular(e, true)).toBe(e);
    }
  });
});

test.describe('Cupo del salón — qué estado libera el asiento', () => {
  test('Devuelto, Rechazado, Retractado y Contrato nulo lo liberan', () => {
    expect([...ESTADOS_LIBERAN_CUPO].sort())
      .toEqual(['contrato nulo', 'devuelto', 'rechazado', 'retractado']);
  });

  test('Aprobado y Pendiente NO están entre los que liberan', () => {
    // Un contrato recién creado aún no tiene `aprobacion`: nace Pendiente de
    // facto y debe RETENER el asiento.
    expect(ESTADOS_LIBERAN_CUPO).not.toContain('aprobado');
    expect(ESTADOS_LIBERAN_CUPO).not.toContain('pendiente');
  });

  test('el SQL DERIVA de la constante, no la repite', () => {
    // Estaba escrita dos veces (la lista y el IN(...) del SQL) y podían divergir.
    const sql = cupoOcupadoSql('p');
    for (const e of ESTADOS_LIBERAN_CUPO) expect(sql).toContain(e);
  });

  test('el SQL exige cupo confirmado, OnHold libre y cupo no liberado a mano', () => {
    const sql = cupoOcupadoSql('p');
    expect(sql).toContain('cupoConfirmado');
    expect(sql).toContain('fechaOnHold');
    expect(sql).toContain('cupoLiberado');
  });

  test('el alias se aplica a todas las columnas', () => {
    expect(cupoOcupadoSql('bene')).toContain('bene."cupoConfirmado"');
    expect(cupoOcupadoSql('bene')).not.toContain('p."cupoConfirmado"');
  });

  test('el estado mostrado prioriza el del titular sobre el del beneficiario', () => {
    expect(estadoContratoDisplay('Retractado', 'Aprobado')).toMatch(/Retractado/i);
  });
});
