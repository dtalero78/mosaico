/**
 * Catálogo compartido de cursos/horarios de MOSAICO (cliente + servidor).
 * Sin 'server-only' — lo usan el wizard de contratos y el admin Crea Campaña.
 */

// Tipos de curso en ORDEN de visualización (menores → adultos).
export const TIPOS_CURSO = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'] as const;
export type TipoCurso = typeof TIPOS_CURSO[number];

// Cursos para menores de edad (no seleccionables cuando el titular es el beneficiario).
export const CURSOS_MENORES: TipoCurso[] = ['YOJI', 'OKINA', 'KODOMO'];

// Posición canónica para ordenar (1-based); desconocidos al final.
export function ordenTipoCurso(tipo: string): number {
  const i = (TIPOS_CURSO as readonly string[]).indexOf(tipo);
  return i < 0 ? 999 : i + 1;
}

export function esMenores(tipo: string): boolean {
  return CURSOS_MENORES.includes(tipo as TipoCurso);
}
export function esImpulsa(tipo: string): boolean {
  return tipo === 'IMPULSA';
}

// Horarios disponibles por tipo de curso (catálogo fijo).
// Menores (YOJI/OKINA/KODOMO): 17:00-18:00, 18:15-19:15, 19:30-20:30. Sábados 09-11 / 11-13.
const HORARIOS_MENORES = [
  'LUN-MIÉ 17:00-18:00',
  'LUN-MIÉ 18:15-19:15',
  'LUN-MIÉ 19:30-20:30',
  'MAR-JUE 17:00-18:00',
  'MAR-JUE 18:15-19:15',
  'MAR-JUE 19:30-20:30',
  'SÁB 09:00-11:00',
  'SÁB 11:00-13:00',
];
const HORARIOS_DANSHI = [
  'LUN-MIÉ 19:00-19:50',
  'MAR-JUE 19:00-19:50',
  'SÁB 09:00-11:00',
  'SÁB 11:00-13:00',
];
const HORARIOS_SENPAI = [
  'LUN-MIÉ 20:00-20:50',
  'MAR-JUE 20:00-20:50',
  'SÁB 09:00-11:00',
  'SÁB 11:00-13:00',
];
const HORARIOS_IMPULSA = ['LUN-MIÉ-VIE 20:00-21:00'];

export function horariosFor(tipo: string): string[] {
  if (!tipo) return [];
  if (tipo === 'IMPULSA') return HORARIOS_IMPULSA;
  if (tipo === 'DANSHI') return HORARIOS_DANSHI;
  if (tipo === 'SENPAI') return HORARIOS_SENPAI;
  return HORARIOS_MENORES; // YOJI / OKINA / KODOMO
}

/** Suma `meses` a una fecha ISO (YYYY-MM-DD) manejando el overflow de fin de mes. */
export function addMonths(isoDate: string, meses: number): string {
  if (!isoDate || !Number.isFinite(meses)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const base = new Date(Date.UTC(y, m - 1, d));
  const targetMonth = base.getUTCMonth() + meses;
  const target = new Date(Date.UTC(base.getUTCFullYear(), targetMonth, 1));
  // Ajuste de día (ej. 31 ene + 1 mes → 28/29 feb)
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
