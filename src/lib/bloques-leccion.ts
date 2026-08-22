/**
 * Cuántas lecciones cubre una sesión (cliente + servidor).
 *
 * Una clase de dos horas se dicta en dos bloques y cubre DOS lecciones, una por
 * bloque — es el caso de los sábados. Las de entre semana duran una hora (o 50
 * minutos) y cubren una.
 *
 * Se deduce de la DURACIÓN, no de una lista de horarios de sábado: hoy son cuatro
 * (`SÁB 09:00-11:00`, `10:00-12:00`, `11:00-13:00`, `11:15-13:15`) y en cuanto se
 * añada un quinto desde Académico › Horarios, la regla lo cubre sola. Listarlos
 * sería garantizar que el próximo se quede fuera sin que nadie se entere.
 */
import { parseHorarioRango } from './cursos-campaign';

/** Desde cuántos minutos una sesión se considera de dos bloques. */
export const MIN_DOS_BLOQUES = 105;

/**
 * Lecciones que cubre una sesión de ese horario: 2 si dura 105 min o más, 1 si no.
 *
 * El umbral está en 105 y no en 120 para que un horario de 1h50 —o uno escrito con
 * cinco minutos de menos— siga contando como bloque doble; el salto real entre los
 * horarios que existen es de 60 a 120 minutos, así que cualquier corte intermedio
 * separa lo mismo, y 105 tolera el redondeo humano.
 */
export function leccionesPorSesion(horarioCurso?: string | null): 1 | 2 {
  const r = horarioCurso ? parseHorarioRango(horarioCurso) : null;
  if (!r) return 1;
  return (r.finMin - r.inicioMin) >= MIN_DOS_BLOQUES ? 2 : 1;
}

/** ¿Esta sesión cubre dos lecciones? */
export function esSesionDoble(horarioCurso?: string | null): boolean {
  return leccionesPorSesion(horarioCurso) === 2;
}

/**
 * Desde cuándo una sesión de dos horas cubre dos lecciones.
 *
 * Es una FECHA FIJA, no "hoy": el mapeo se recalcula cada vez que se regenera un
 * curso —y regenerar BORRA y recrea los eventos, así que las etiquetas anteriores
 * no sobreviven para consultarlas—. Con un corte móvil, cada regeneración
 * congelaría más sesiones como de una lección y correría todo el currículo; con
 * uno fijo, el resultado es el mismo hoy que dentro de seis meses.
 *
 * Las sesiones ANTERIORES a esta fecha cubren una lección: es lo que realmente se
 * dictó (el último sábado dictado fue el 08-ago; el primero bajo la regla nueva es
 * el 22-ago, así que el corte cae en medio y no parte ninguna semana).
 */
export const INICIO_DOS_BLOQUES = '2026-08-21';

/** Lecciones que cubre esa sesión, contando la fecha: antes del corte, siempre 1. */
export function leccionesDeSesion(fecha: string | Date | null | undefined, horarioCurso?: string | null): 1 | 2 {
  const iso = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha || '').slice(0, 10);
  if (!iso || iso < INICIO_DOS_BLOQUES) return 1;
  return leccionesPorSesion(horarioCurso);
}
