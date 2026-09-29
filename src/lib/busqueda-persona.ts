/**
 * Búsqueda por nombre, ID o contrato sobre filas ya cargadas (del lado del
 * navegador). La versión para consultas SQL vive en `filtro-usuario.ts`.
 *
 * Client + server safe (sin 'server-only').
 */

export interface PersonaBuscable {
  nombre?: string | null;
  numeroId?: string | null;
  contrato?: string | null;
}

/** Minúsculas y sin acentos: "Peña" y "pena" se encuentran. */
const plano = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Sólo letras y dígitos: el documento y el contrato se teclean con o sin puntos y guiones. */
const compacto = (s: unknown) => plano(s).replace(/[^a-z0-9]/g, '');

/**
 * ¿La persona coincide con lo tecleado?
 *
 * - Nombre: contiene el texto, sin importar acentos ni mayúsculas.
 * - ID y contrato: se comparan sin puntos, guiones ni espacios, así
 *   `15.434.727-5` encuentra `154347275` y `2820-26` encuentra `01-M5-2820-26`.
 *
 * Un texto que al compactarse queda vacío (sólo signos) no busca por ID ni
 * contrato: coincidiría con todo.
 */
export function coincidePersona(p: PersonaBuscable, texto: string): boolean {
  const q = plano(texto);
  if (!q) return true;
  if (plano(p.nombre).replace(/\s+/g, ' ').includes(q.replace(/\s+/g, ' '))) return true;
  const qc = compacto(texto);
  if (!qc) return false;
  return compacto(p.numeroId).includes(qc) || compacto(p.contrato).includes(qc);
}
