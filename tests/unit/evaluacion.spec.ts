import { test, expect } from '@playwright/test';
import {
  EVALUACION_STEP, esModuloEvaluacion, esModuloEntrenamiento, esSesionEvaluacion,
} from '../../src/lib/evaluacion';

test.describe('Qué sesión es una EVALUACIÓN', () => {
  test('lo declara el MÓDULO, que es como el currículo lo separa', () => {
    // NIVELES trae `Evaluacion 01` y `Entrenamiento 02` como módulos propios: por
    // eso la evaluación se reconoce por el módulo, no por una regla inventada.
    expect(esModuloEvaluacion('Evaluacion 01')).toBe(true);
    expect(esModuloEvaluacion('Evaluacion 03')).toBe(true);
    expect(esModuloEntrenamiento('Entrenamiento 01')).toBe(true);
  });

  test('la tilde no decide nada: NIVELES escribe las dos formas', () => {
    // DANSHI/KODOMO guardan "Evaluacion 01" y YOJI "Evaluación 01".
    expect(esModuloEvaluacion('Evaluación 01')).toBe(true);
    expect(esModuloEvaluacion('EVALUACION 02')).toBe(true);
    expect(esModuloEvaluacion('  evaluacion 03  ')).toBe(true);
  });

  test('un módulo de contenido NO es evaluación', () => {
    expect(esModuloEvaluacion('Modulo 00')).toBe(false);   // inducción
    expect(esModuloEvaluacion('Modulo 01')).toBe(false);
    expect(esModuloEvaluacion(null)).toBe(false);
    expect(esModuloEvaluacion('')).toBe(false);
  });

  test('la sesión declarada se reconoce por su módulo, aunque su lección sea normal', () => {
    // Así se dicta hoy: "Evaluacion 01 / Leccion 16" es la evaluación del Nivel 1.
    expect(esSesionEvaluacion('Evaluacion 01', 'Leccion 16')).toBe(true);
    expect(esSesionEvaluacion('Evaluación 01', 'Lección 25')).toBe(true);
  });

  test('sigue reconociendo la etiqueta SINTÉTICA de los salones que ya la dictaron', () => {
    // Los 92 salones en marcha conservan su secuencia legacy: el guía debe seguir
    // viendo el cartel y el flujo de aprobar en esas sesiones.
    expect(esSesionEvaluacion('Modulo 01', EVALUACION_STEP)).toBe(true);
    expect(esSesionEvaluacion('Modulo 02', 'Evaluacion')).toBe(true);  // sin tilde
  });

  test('una lección de contenido no se confunde con una evaluación', () => {
    expect(esSesionEvaluacion('Modulo 01', 'Leccion 01')).toBe(false);
    expect(esSesionEvaluacion('Modulo 00', 'Leccion 00')).toBe(false);
    expect(esSesionEvaluacion(null, null)).toBe(false);
  });
});
