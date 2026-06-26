/**
 * Generador de "userLogin" para estudiantes (MOSAICO) — cliente + servidor.
 *
 * Reglas:
 *  - 10 caracteres, alfanuméricos en minúscula.
 *  - Derivado del primer nombre + primer apellido + documento, con una parte
 *    ALEATORIA (para variar entre homónimos y reducir colisiones).
 *  - Es el identificador con el que el estudiante inicia sesión (USUARIOS_ROLES.userLogin).
 */

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DIACRITICOS = /[̀-ͯ]/g;

function normalizar(s: string | null | undefined): string {
  return String(s || '')
    .normalize('NFD')
    .replace(DIACRITICOS, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function aleatorio(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return out;
}

/**
 * Genera un userLogin de 10 caracteres: hasta 3 del nombre + 3 del apellido +
 * 2 del documento + 2 aleatorios (rellena con aleatorios si las partes son cortas).
 */
export function generateUserLogin(
  primerNombre?: string | null,
  primerApellido?: string | null,
  documento?: string | null
): string {
  const n = normalizar(primerNombre).slice(0, 3);
  const a = normalizar(primerApellido).slice(0, 3);
  const d = normalizar(documento).slice(-2);
  let base = `${n}${a}${d}`;
  // Parte aleatoria (siempre presente) para el componente "aleatorio".
  base += aleatorio(2);
  if (base.length < 10) base += aleatorio(10 - base.length);
  return base.slice(0, 10);
}
