import { test, expect } from '@playwright/test';
import {
  extractStepNumber, isJumpStep, isExitosa, aproboElJump, getClassType, esTrainingClub,
} from '../../src/lib/motor-academico';

test.describe('Número del step', () => {
  test('lee el número con y sin prefijo de club', () => {
    expect(extractStepNumber('Step 7')).toBe(7);
    expect(extractStepNumber('TRAINING - Step 7')).toBe(7);
    expect(extractStepNumber('KARAOKE - Step 45')).toBe(45);
  });

  test('el espacio es opcional — así lo hacían 5 de las 6 copias', () => {
    // La del modal del calendario exigía `\s+` y a "Step7" le daba null.
    expect(extractStepNumber('Step7')).toBe(7);
  });

  test('no distingue mayúsculas', () => {
    expect(extractStepNumber('step 3')).toBe(3);
    expect(extractStepNumber('STEP 3')).toBe(3);
  });

  test('lo que no es un step da null, sin reventar', () => {
    expect(extractStepNumber(null)).toBeNull();
    expect(extractStepNumber(undefined)).toBeNull();
    expect(extractStepNumber('')).toBeNull();
    expect(extractStepNumber('Leccion 04')).toBeNull();
    expect(extractStepNumber('WELCOME')).toBeNull();
  });

  test('ordena por número, no por texto', () => {
    // El fallo clásico: "Step 10" antes que "Step 6" si se ordena alfabéticamente.
    const orden = ['Step 10', 'Step 6', 'Step 2']
      .sort((a, b) => (extractStepNumber(a) ?? 0) - (extractStepNumber(b) ?? 0));
    expect(orden).toEqual(['Step 2', 'Step 6', 'Step 10']);
  });
});

test.describe('Jump', () => {
  test('los múltiplos de 5 hasta 45 son jump', () => {
    for (const n of [5, 10, 15, 20, 25, 30, 35, 40, 45]) {
      expect(isJumpStep(`Step ${n}`), `Step ${n}`).toBe(true);
    }
  });

  test('los demás no', () => {
    for (const n of [1, 4, 6, 11, 44, 46, 47]) {
      expect(isJumpStep(`Step ${n}`), `Step ${n}`).toBe(false);
    }
  });

  test('Step 0 no es jump aunque 0 sea múltiplo de 5', () => {
    expect(isJumpStep('Step 0')).toBe(false);
  });

  test('⚠ Step 50 sale como jump: la regla es aritmética', () => {
    // Step 50 es DONE. Queda documentado aquí porque es lo que hacen hoy los
    // servicios; el panel de la sesión usaba una lista literal [5..45] y no lo
    // marcaba. Acotar el rango sería un cambio de comportamiento, no un refactor.
    expect(isJumpStep('Step 50')).toBe(true);
  });

  test('un nombre sin step no es jump', () => {
    expect(isJumpStep('Leccion 05')).toBe(false);
    expect(isJumpStep(null)).toBe(false);
  });
});

test.describe('Clase exitosa — la participación NO cuenta', () => {
  test('basta con cualquiera de las dos marcas de asistencia', () => {
    expect(isExitosa({ asistio: true })).toBe(true);
    expect(isExitosa({ asistencia: true })).toBe(true);
  });

  test('participar sin asistir NO la vuelve exitosa', () => {
    // Es la divergencia que tenía la copia de las complementarias: incluía
    // `participacion === true` y decidía la elegibilidad con otro criterio que
    // el diagnóstico «¿Cómo voy?».
    expect(isExitosa({ participacion: true })).toBe(false);
    expect(isExitosa({ participacion: true, asistio: false })).toBe(false);
  });

  test('sin marcas no es exitosa', () => {
    expect(isExitosa({})).toBe(false);
    expect(isExitosa({ asistio: null, asistencia: null })).toBe(false);
  });

  test('sólo el booleano true cuenta, no un valor que parezca verdadero', () => {
    expect(isExitosa({ asistio: 1 as any })).toBe(false);
    expect(isExitosa({ asistio: 'true' as any })).toBe(false);
  });
});

test.describe('Aprobación del Jump — las cuatro condiciones en el MISMO intento', () => {
  const aprobado = { asistio: true, participacion: true, noAprobo: false, cancelo: false };

  test('con las cuatro, aprueba', () => {
    expect(aproboElJump(aprobado)).toBe(true);
    expect(aproboElJump({ asistencia: true, participacion: true })).toBe(true);
  });

  test('falta cualquiera y no aprueba', () => {
    expect(aproboElJump({ ...aprobado, asistio: false, asistencia: false })).toBe(false);
    expect(aproboElJump({ ...aprobado, participacion: false })).toBe(false);
    expect(aproboElJump({ ...aprobado, noAprobo: true })).toBe(false);
    expect(aproboElJump({ ...aprobado, cancelo: true })).toBe(false);
  });

  test('asistir y participar no basta si el guía marcó que no aprobó', () => {
    expect(aproboElJump({ asistio: true, participacion: true, noAprobo: true })).toBe(false);
  });

  test('un intento reprobado NO bloquea uno posterior que sí apruebe', () => {
    // Se evalúa con `.some()` sobre los intentos, no con `.every()`. Es el caso
    // real que dejó a una alumna pegada tras reprobar dos veces y aprobar a la
    // cuarta.
    const intentos = [
      { asistio: true, participacion: true, noAprobo: true },
      { asistio: true, participacion: false },
      { asistio: true, participacion: true, noAprobo: false, cancelo: false },
    ];
    expect(intentos.some(aproboElJump)).toBe(true);
  });

  test('si todos los intentos fallan, no aprueba', () => {
    const intentos = [
      { asistio: true, participacion: true, noAprobo: true },
      { cancelo: true },
    ];
    expect(intentos.some(aproboElJump)).toBe(false);
  });
});

test.describe('Tipo de clase', () => {
  test('el tipo explícito manda', () => {
    expect(getClassType({ tipo: 'SESSION' })).toBe('SESSION');
    expect(getClassType({ tipo: 'CLUB' })).toBe('CLUB');
  });

  test('una COMPLEMENTARIA cuenta como SESSION: sustituye a la que falta', () => {
    expect(getClassType({ tipo: 'COMPLEMENTARIA' })).toBe('SESSION');
  });

  test('sin tipo se deduce del nombre del step — los migrados de Wix', () => {
    expect(getClassType({ step: 'Step 7' })).toBe('SESSION');
    expect(getClassType({ step: 'TRAINING - Step 7' })).toBe('CLUB');
  });

  test('los otros clubes no cuentan como sesión ni como club del step', () => {
    for (const s of ['KARAOKE - Step 7', 'PRONUNCIATION - Step 7', 'LISTENING - Step 7']) {
      expect(getClassType({ step: s }), s).toBe('OTHER');
    }
  });

  test('sin tipo y sin step, OTHER', () => {
    expect(getClassType({})).toBe('OTHER');
  });
});

test.describe('Club TRAINING — el único que completa un step', () => {
  test('reconoce el prefijo con y sin espacios', () => {
    expect(esTrainingClub('TRAINING - Step 7')).toBe(true);
    expect(esTrainingClub('TRAINING- Step 7')).toBe(true);
    expect(esTrainingClub('training - Step 7')).toBe(true);
  });

  test('los demás clubes NO satisfacen el requisito', () => {
    for (const s of ['PRONUNCIATION - Step 7', 'GRAMMAR - Step 7', 'LISTENING - Step 7', 'KARAOKE - Step 7']) {
      expect(esTrainingClub(s), s).toBe(false);
    }
  });

  test('no confunde una sesión con el club', () => {
    expect(esTrainingClub('Step 7')).toBe(false);
    expect(esTrainingClub(null)).toBe(false);
  });
});
