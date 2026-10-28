/**
 * Identidad de un curso de campaña = campaña + tipo + horario + SALÓN.
 *
 * Antes era sólo (campaña, tipo, horario): dos salones del mismo tipo no podían compartir
 * horario. El salón ya se guarda en PEOPLE.salon (los 1.174 beneficiarios con campaña lo
 * tienen y coincide con su curso), así que sumarlo a la clave no mueve ningún dato.
 *
 * Client-safe (sin imports de servidor): lo usan pantallas y servicios.
 */

/** "Salon 9", "Salón 9", " 9 " → "9". Vacío → null. El salón se guarda sólo como su número/nombre. */
export function normalizarSalon(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/^sal[oó]n\s*/i, '').trim();
  return s || null;
}

export interface CursoRef {
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  salon?: string | null;
}

/** Igualdad de salón tolerante a nulos, para SQL: `a."salon" IS NOT DISTINCT FROM b."salon"`. */
export const sqlMismoSalon = (a: string, b: string) => `${a}."salon" IS NOT DISTINCT FROM ${b}."salon"`;

/** Clave de texto estable de un curso (locks, mapas). */
export const claveCurso = (c: CursoRef) =>
  `${c.campaign}|${c.tipoCurso}|${c.horarioCurso}|${normalizarSalon(c.salon) ?? ''}`;
