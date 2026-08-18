import { test, expect } from '@playwright/test';
import {
  APROBACION, APROBACION_APROBADO_LEGACY, esAprobado, esAprobadoSql,
  ESTADO, TIPO_USUARIO,
} from '../../src/lib/estados';
import { TZ_OPERACION } from '../../src/lib/cursos-campaign';
import { IMPULSA_AUTHOR_TZ } from '../../src/lib/impulsa-calendario';

test.describe('Contrato aprobado — una sola definición para 28 archivos', () => {
  test('reconoce el valor real de MOSAICO', () => {
    expect(esAprobado(APROBACION.APROBADO)).toBe(true);
    expect(esAprobado('Aprobado')).toBe(true);
  });

  test('tolera la grafía femenina heredada de LGS', () => {
    // 0 filas en MOSAICO, pero al LEER no cuesta nada aceptarla; lo que se
    // eliminó es tenerla escrita a mano en unas comparaciones y en otras no.
    expect(esAprobado(APROBACION_APROBADO_LEGACY)).toBe(true);
  });

  test('ningún otro estado cuenta como aprobado', () => {
    for (const e of [APROBACION.PENDIENTE, APROBACION.DEVUELTO, APROBACION.RECHAZADO,
                     APROBACION.RETRACTADO, APROBACION.CONTRATO_NULO, APROBACION.FINALIZADA]) {
      expect(esAprobado(e), e).toBe(false);
    }
  });

  test('vacío y nulo no son aprobado', () => {
    expect(esAprobado(null)).toBe(false);
    expect(esAprobado(undefined)).toBe(false);
    expect(esAprobado('')).toBe(false);
    expect(esAprobado('   ')).toBe(false);
  });

  test('los espacios al borde no rompen la comparación', () => {
    expect(esAprobado('  Aprobado  ')).toBe(true);
  });

  test('distingue mayúsculas: el valor guardado es exactamente "Aprobado"', () => {
    // No se normaliza a minúsculas a propósito — el dato es consistente en la
    // base (1129 filas, 0 con espacios) y aflojar la comparación escondería un
    // dato sucio en vez de mostrarlo.
    expect(esAprobado('APROBADO')).toBe(false);
    expect(esAprobado('aprobado')).toBe(false);
  });

  test('el SQL cubre las dos grafías y lleva la columna que se le pase', () => {
    const sql = esAprobadoSql('p."aprobacion"');
    expect(sql).toContain('p."aprobacion"');
    expect(sql).toContain(APROBACION.APROBADO);
    expect(sql).toContain(APROBACION_APROBADO_LEGACY);
  });

  test('el SQL y la función coinciden en qué es aprobado', () => {
    // Si alguien añade un valor a APROBACION, este test recuerda que la lista
    // del SQL sale de las mismas constantes.
    const sql = esAprobadoSql('"x"');
    for (const v of [APROBACION.APROBADO, APROBACION_APROBADO_LEGACY]) {
      expect(esAprobado(v), v).toBe(true);
      expect(sql.includes(`'${v}'`), v).toBe(true);
    }
  });
});

test.describe('Catálogo de estados', () => {
  test('están los valores que existen hoy en la base', () => {
    expect(Object.values(ESTADO)).toEqual(
      expect.arrayContaining(['ACTIVA', 'PENDIENTE', 'RETRACTADO', 'ANULADO', 'On Hold', 'FINALIZADA']));
  });

  test('sólo hay dos tipos de persona', () => {
    expect(Object.values(TIPO_USUARIO).sort()).toEqual(['BENEFICIARIO', 'TITULAR']);
  });
});

test.describe('Zona horaria de operación', () => {
  test('es Chile', () => {
    expect(TZ_OPERACION).toBe('America/Santiago');
  });

  test('las constantes que había repartidas DERIVAN de ella', () => {
    // Había cuatro constantes distintas con el mismo valor. Cambiar una y no las
    // otras es el fallo que ya ocurrió con Bogotá en el estado de campaña.
    expect(IMPULSA_AUTHOR_TZ).toBe(TZ_OPERACION);
  });
});
