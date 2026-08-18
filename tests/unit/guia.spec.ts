import { test, expect } from '@playwright/test';
import { guiaAsignado } from '../../src/lib/guia';
import { horariosSeSolapan } from '../../src/lib/cursos-campaign';

test.describe('¿Hay guía asignado? — sólo un guía real puede colisionar', () => {
  test('un id de guía se conserva tal cual', () => {
    expect(guiaAsignado('adv_1782671754369_6cndhe6oo')).toBe('adv_1782671754369_6cndhe6oo');
  });

  test('recorta los espacios', () => {
    expect(guiaAsignado('  adv_1  ')).toBe('adv_1');
  });

  test('NULL y vacío son «sin guía»', () => {
    expect(guiaAsignado(null)).toBeNull();
    expect(guiaAsignado(undefined)).toBeNull();
    expect(guiaAsignado('')).toBeNull();
    expect(guiaAsignado('    ')).toBeNull();
  });

  test('el TEXTO "null" también es «sin guía» — era la causa del aviso falso', () => {
    // Un curso quedó guardado con el string "null" (el formulario mandó el valor
    // no elegido convertido a cadena). Para el código anterior eso era un guía
    // cuyo id es «null», y cualquier curso nuevo sin guía chocaba contra él.
    expect(guiaAsignado('null')).toBeNull();
    expect(guiaAsignado('NULL')).toBeNull();
    expect(guiaAsignado(' Null ')).toBeNull();
    expect(guiaAsignado('undefined')).toBeNull();
    expect(guiaAsignado('none')).toBeNull();
    expect(guiaAsignado('-')).toBeNull();
  });

  test('no descarta un id que sólo CONTENGA esas palabras', () => {
    // "null" suelto no es guía; "adv_null_1" sí es un id y hay que respetarlo.
    expect(guiaAsignado('adv_null_1')).toBe('adv_null_1');
  });
});

test.describe('Dos cursos sin guía NO chocan', () => {
  // Se reproduce la regla de chocanCursos en su parte de guía: el servicio real
  // es server-only (usa la BD) y no se puede importar desde el runner.
  const mismoGuia = (a: string | null, b: string | null) => {
    const x = guiaAsignado(a), y = guiaAsignado(b);
    return !!x && !!y && x === y;
  };

  test('el mismo horario con los dos sin guía no es colisión', () => {
    expect(horariosSeSolapan('LUN-MIÉ 17:00-18:00', 'LUN-MIÉ 17:00-18:00')).toBe(true);
    expect(mismoGuia(null, null)).toBe(false);
    expect(mismoGuia('', '')).toBe(false);
    expect(mismoGuia('null', 'null')).toBe(false);
    expect(mismoGuia(null, 'null')).toBe(false);
  });

  test('con un guía a un lado y ninguno al otro, tampoco', () => {
    expect(mismoGuia('adv_1', null)).toBe(false);
    expect(mismoGuia('adv_1', 'null')).toBe(false);
  });

  test('el mismo guía real sí puede chocar', () => {
    expect(mismoGuia('adv_1', 'adv_1')).toBe(true);
  });

  test('dos guías distintos nunca chocan entre sí', () => {
    expect(mismoGuia('adv_1', 'adv_2')).toBe(false);
  });
});
