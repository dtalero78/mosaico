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
 * Desde qué campaña se aplica: las que empiezan en AGOSTO 2026 o después.
 *
 * Las campañas anteriores (DICIEMBRE012025M, ENERO262026M, ABRIL132026M,
 * JUNIO082026M) llevan meses en marcha con alumnos en distintos puntos del
 * currículo: repartirles dos lecciones por sábado les correría la posición de
 * todas las clases futuras, y eso hay que revisarlo alumno por alumno. Quedan
 * para ajuste manual.
 *
 * Se compara contra `inicioCurso` y no contra el nombre de la campaña porque el
 * nombre no siempre es legible — `0CTUBRE192026M` va con un cero, y ningún
 * parser de nombres lo reconoce como octubre. La fecha de inicio sí es un dato.
 */
export const INICIO_CAMPANAS_DOS_BLOQUES = '2026-08-01';

/** ¿A este curso se le aplica la regla, por la campaña a la que pertenece? */
export function campanaAplicaDosBloques(inicioCurso: string | Date | null | undefined): boolean {
  const iso = inicioCurso instanceof Date
    ? inicioCurso.toISOString().slice(0, 10)
    : String(inicioCurso || '').slice(0, 10);
  return !!iso && iso >= INICIO_CAMPANAS_DOS_BLOQUES;
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
 * dictó. Hoy ninguna campaña alcanzada por la regla tiene sábados ya dictados
 * (AGOSTO172026M empieza el 17-ago y su primer sábado es el 22), así que el corte
 * es una red de seguridad para las regeneraciones de aquí en adelante.
 */
export const INICIO_DOS_BLOQUES = '2026-08-21';

/**
 * Lecciones que cubre esa sesión. Es 1 salvo que se cumplan las tres: la campaña
 * está dentro del alcance, la clase dura dos horas y la fecha es posterior al corte.
 */
export function leccionesDeSesion(
  fecha: string | Date | null | undefined,
  horarioCurso?: string | null,
  inicioCurso?: string | Date | null,
): 1 | 2 {
  // Sin `inicioCurso` no se puede saber la campaña: se asume dentro del alcance
  // para que quien ya pasa fecha + horario (y los tests de la regla) no cambie.
  if (inicioCurso !== undefined && !campanaAplicaDosBloques(inicioCurso)) return 1;
  const iso = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha || '').slice(0, 10);
  if (!iso || iso < INICIO_DOS_BLOQUES) return 1;
  return leccionesPorSesion(horarioCurso);
}
