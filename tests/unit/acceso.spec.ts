import { test, expect } from '@playwright/test';
import { computePlataformaScope, buildPlataformaWhereSql } from '../../src/lib/recaudos-scope';
import { requireAdmin } from '../../src/lib/api-permissions';
import { Role } from '../../src/types/permissions';

const sesion = (rol: string | null) => ({ user: { role: rol } }) as any;

test.describe('Quién ve qué en Recaudos — alcance por plataforma', () => {
  test('los administradores ven todo', () => {
    expect(computePlataformaScope('SUPER_ADMIN', 'Chile').filter).toBeNull();
    expect(computePlataformaScope('ADMIN', 'Chile').filter).toBeNull();
  });

  test('sin plataforma asignada se ve todo (compatibilidad con lo ya existente)', () => {
    expect(computePlataformaScope('RECAUDOS_JEFE', null).filter).toBeNull();
    expect(computePlataformaScope('RECAUDOS_JEFE', '   ').filter).toBeNull();
  });

  test('Internacional ve todo', () => {
    expect(computePlataformaScope('RECAUDOS_JEFE', 'Internacional').filter).toBeNull();
  });

  test('Chile queda AISLADO: sólo Chile', () => {
    expect(computePlataformaScope('RECAUDOS_JEFE', 'Chile').filter)
      .toEqual({ type: 'include', values: ['chile'] });
  });

  test('Colombia es "todo lo demás": excluye Chile', () => {
    expect(computePlataformaScope('RECAUDOS_JEFE', 'Colombia').filter)
      .toEqual({ type: 'exclude', values: ['chile'] });
  });

  test('cualquier otro país ve sólo el suyo', () => {
    expect(computePlataformaScope('RECAUDOS_JEFE', 'Ecuador').filter)
      .toEqual({ type: 'include', values: ['ecuador'] });
  });

  test('la comparación no depende de mayúsculas ni de espacios', () => {
    expect(computePlataformaScope('RECAUDOS_JEFE', '  CHILE  ').filter)
      .toEqual({ type: 'include', values: ['chile'] });
  });

  test('en un filtro de exclusión, NULL queda VISIBLE; en uno de inclusión, no', () => {
    // Es la diferencia que decide si un titular sin plataforma aparece o no:
    // "todo lo demás" incluye a los que no tienen país; "sólo Chile" no.
    const excl = buildPlataformaWhereSql(computePlataformaScope('X', 'Colombia'), 'p."plataforma"', 1);
    expect(excl.sql).toContain('IS NULL');

    const incl = buildPlataformaWhereSql(computePlataformaScope('X', 'Chile'), 'p."plataforma"', 1);
    expect(incl.sql).not.toContain('IS NULL');
  });

  test('sin filtro no se agrega SQL ni parámetros', () => {
    const r = buildPlataformaWhereSql({ filter: null }, 'p."plataforma"', 3);
    expect(r.sql).toBe('');
    expect(r.params).toEqual([]);
  });

  test('el índice del parámetro se respeta', () => {
    const r = buildPlataformaWhereSql(computePlataformaScope('X', 'Chile'), 'p."plataforma"', 7);
    expect(r.sql).toContain('$7');
  });
});

test.describe('requireAdmin — repartir accesos no se delega por permiso', () => {
  test('SUPER_ADMIN y ADMIN pasan', () => {
    expect(() => requireAdmin(sesion(Role.SUPER_ADMIN))).not.toThrow();
    expect(() => requireAdmin(sesion(Role.ADMIN))).not.toThrow();
    expect(() => requireAdmin(sesion('admin'))).not.toThrow();
  });

  test('cualquier otro rol es rechazado, incluido el del alumno', () => {
    for (const rol of ['ESTUDIANTE', 'GUIA', 'COMERCIAL', 'COORDINADOR_ACADEMICO', 'RECAUDOS_JEFE']) {
      expect(() => requireAdmin(sesion(rol)), rol).toThrow(/Solo SUPER_ADMIN/);
    }
  });

  test('sin sesión también se rechaza', () => {
    expect(() => requireAdmin(null)).toThrow(/Solo SUPER_ADMIN/);
    expect(() => requireAdmin({} as any)).toThrow(/Solo SUPER_ADMIN/);
  });

  test('el mensaje nombra la acción, para que el error sea legible', () => {
    expect(() => requireAdmin(sesion('ESTUDIANTE'), 'cambiar el rol de un usuario'))
      .toThrow(/cambiar el rol de un usuario/);
  });
});
