/**
 * Cuándo dos cursos se pisan EN EL TIEMPO (para la colisión de guía).
 *
 * Vive en `lib/` —y no dentro del servicio— por lo mismo que `guia.ts`: el
 * servicio es server-only y toca la BD, así que los tests y los scripts no
 * podrían cargarlo para revisar la regla.
 *
 * Dos ideas, y las dos vienen de casos reales:
 *
 *  1. El fin del curso es el de su **última clase** cuando ésta cae después de
 *     `finalCurso`: las clases que caen en festivo se corren al final, así que
 *     un curso puede seguir dictándose semanas después de su fecha nominal.
 *  2. Un curso **terminado** no ocupa al guía. Antes se comparaban los dos
 *     periodos entre sí, sin mirar el calendario: dos cursos que se pisaron en
 *     el pasado seguían chocando para siempre y no había forma de reasignar al
 *     guía cuando el curso viejo ya había cerrado (ENERO262026M, sep-2026).
 */

const soloFecha = (v: any): string | null => (v ? String(v).slice(0, 10) : null);

/** Fin real del curso: la última clase si cae después del `finalCurso` nominal. */
export function finEfectivoCurso(
  finalCurso: string | null | undefined,
  ultimaClase: string | null | undefined
): string | null {
  const f = soloFecha(finalCurso);
  const u = soloFecha(ultimaClase);
  if (!f) return u;
  if (!u) return f;
  return u > f ? u : f;
}

/**
 * ¿Se solapan los periodos [aIni,aFin] y [bIni,bFin] de HOY en adelante?
 *
 * Si a alguno le faltan fechas no se puede descartar el choque → se considera
 * que sí se solapan (conservador: preferimos avisar de más que dejar pasar un
 * cruce real) y el llamador lo marca como `vigenciaIndeterminada`.
 */
export function vigenciasSeSolapan(
  aIni: string | null, aFin: string | null,
  bIni: string | null, bFin: string | null,
  hoy: string
): { solapan: boolean; indeterminada: boolean } {
  if ((aFin && aFin < hoy) || (bFin && bFin < hoy)) return { solapan: false, indeterminada: false };
  if (!aIni || !aFin || !bIni || !bFin) return { solapan: true, indeterminada: true };
  return { solapan: aIni <= bFin && bIni <= aFin, indeterminada: false };
}
