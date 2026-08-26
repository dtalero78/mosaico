/**
 * Cuentas de Coordinación que quedan FUERA de la comparación entre guías.
 *
 * Son quienes ejecutan la gestión: entran a registrar la sesión que el guía no
 * cerró y cierran los informes que quedaron abiertos. Si contaran como un guía
 * más, el promedio contra el que se compara a los demás estaría formado en buena
 * parte por su propio trabajo de rescate, y saldría distorsionado.
 *
 * Se identifican por CORREO y no por id: el correo es estable aunque se recree la
 * ficha del guía, y se lee sin tener que abrir la base.
 */
export const CORREOS_COORDINACION = [
  'lopezcar@hotmail.com',        // Carlos Alberto López Alarco
  'admin@mosaicosoroban.cl',     // Coordinación Académica
  'mmartinez99@gmail.com',       // Miguel Angel Martinez
];

/** ¿Este correo es una cuenta de Coordinación? (case-insensitive, tolera espacios) */
export function esCuentaCoordinacion(email?: string | null): boolean {
  const e = String(email || '').trim().toLowerCase();
  return !!e && CORREOS_COORDINACION.includes(e);
}
