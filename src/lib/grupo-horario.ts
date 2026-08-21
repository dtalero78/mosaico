/**
 * Grupos de salón: hasta 3 cursos de la MISMA campaña que comparten guía y
 * horario. El guía dicta una sola sesión y atiende a los alumnos de los 3
 * cursos, pero **la asistencia se marca por curso** — cada curso conserva sus
 * propios eventos, su propio roster y su propio cupo.
 *
 * Cliente + servidor (sin `server-only`): la UI de Campañas lo usa para validar
 * antes de enviar, y el backend para validar de verdad. El cálculo del
 * `eventoCompartidoId` (que necesita `crypto` de Node) vive aparte, en
 * [grupo-horario-server.ts](./grupo-horario-server.ts), para no arrastrar ese
 * import al bundle del navegador.
 */

/** 1 curso padre + hasta 2 adicionales. */
export const MAX_CURSOS_GRUPO = 3;

/**
 * ¿El horario es de sábado? El modal "¿va a adicionar salón?" sólo aparece ahí
 * (decisión del usuario). Tolera "SÁB"/"SAB" y mayúsculas/minúsculas.
 */
export function esHorarioSabado(horarioCurso?: string | null): boolean {
  // Sin regex de diacríticos: un rango de combinantes escrito con los caracteres
  // literales se corrompe al copiarse entre editores. Comparar las dos formas
  // que realmente existen en los datos es suficiente y no se puede romper.
  const h = String(horarioCurso || '').trim().toUpperCase();
  return h.startsWith('SAB') || h.startsWith('SÁB');
}

export interface CursoAgrupable {
  _id?: string;
  campaign?: string | null;
  tipoCurso?: string | null;
  salon?: string | null;
  horarioCurso?: string | null;
  guia?: string | null;
  grupoHorarioId?: string | null;
}

/**
 * ¿Se pueden agrupar estos cursos? (null = sí)
 *
 * Reglas: misma campaña, MISMO horario (decisión del usuario), un solo guía,
 * máximo 3, sin repetir el mismo curso, y ninguno puede estar ya en otro grupo.
 *
 * Un curso SIN guía no bloquea: unir salones es justamente declarar que ese guía
 * los dicta todos, así que hereda el del grupo (ver `guiaDelGrupo`). Lo que sí se
 * rechaza es que dos cursos traigan guías DISTINTOS — eso sería quitarle el curso
 * a alguien sin decirlo.
 * NO se restringe qué tipo de curso va con cuál — queda a criterio del admin
 * (lo habitual es DANSHI con SENPAI, pero no se impone).
 */
export function motivoNoAgrupable(cursos: CursoAgrupable[]): string | null {
  if (cursos.length < 2) return 'Hacen falta al menos 2 cursos para formar un grupo.';
  if (cursos.length > MAX_CURSOS_GRUPO) {
    return `Un grupo admite máximo ${MAX_CURSOS_GRUPO} cursos (1 principal + 2 adicionales).`;
  }

  const norm = (v: any) => String(v ?? '').trim();
  const [base] = cursos;

  for (const c of cursos) {
    if (!norm(c.campaign) || !norm(c.tipoCurso) || !norm(c.horarioCurso)) {
      return 'A alguno de los cursos le falta campaña, curso u horario.';
    }
    if (norm(c.campaign) !== norm(base.campaign)) return 'Los cursos deben ser de la misma campaña.';
    if (norm(c.horarioCurso) !== norm(base.horarioCurso)) {
      return `Los cursos del grupo deben coincidir en horario (${norm(base.horarioCurso)}).`;
    }
  }

  const guias = Array.from(new Set(cursos.map(c => norm(c.guia)).filter(Boolean)));
  if (guias.length === 0) return 'Ninguno de los cursos tiene guía: asígnale uno al principal antes de unirlos.';
  if (guias.length > 1) return 'Los cursos del grupo deben tener el mismo guía.';

  // Un curso es una fila de CURSOS_CAMPAIGN: repetir la misma sería agrupar algo consigo mismo.
  const claves = cursos.map(c => norm(c._id) || `${norm(c.tipoCurso)}|${norm(c.salon)}`);
  if (new Set(claves).size !== claves.length) return 'Hay un curso repetido en el grupo.';

  return null;
}

/**
 * El guía del grupo: el único no vacío entre sus cursos. Los que no lo tengan lo
 * heredan al unirse (`unirCursosEnGrupo`), que es lo que el admin está declarando.
 */
export function guiaDelGrupo(cursos: CursoAgrupable[]): string | null {
  const guias = Array.from(new Set(cursos.map(c => String(c.guia ?? '').trim()).filter(Boolean)));
  return guias.length === 1 ? guias[0] : null;
}

/** Etiqueta corta de un curso para mensajes y para la pestaña Colisiones. */
export function etiquetaCurso(c: CursoAgrupable & { guiaNombre?: string | null }): string {
  const partes = [c.tipoCurso, c.salon ? `Salón ${c.salon}` : null, c.horarioCurso].filter(Boolean);
  return partes.join(' · ');
}

/**
 * ¿La colisión de guía se puede resolver UNIENDO los salones?
 *
 * Sólo si el choque es por el MISMO horario exacto y dentro de la misma campaña:
 * eso significa que los dos cursos son literalmente la misma hora de clase, que es
 * lo que un grupo de salón declara. Si sólo se solapan (19:00-20:00 contra
 * 19:30-20:30) no hay un evento común que compartir, y la única salida sigue
 * siendo cambiar el horario o el guía.
 *
 * No mira el tipo de curso (lo habitual es DANSHI con SENPAI, pero no se impone)
 * ni el día de la semana — mismo criterio que la pestaña Colisiones, para que la
 * misma acción no se comporte distinto según desde dónde se haga.
 */
export function colisionesUnibles(
  curso: { campaign?: string | null; horarioCurso?: string | null },
  colisiones: Array<{ campaign?: string | null; horarioCurso?: string | null }>
): boolean {
  const norm = (v: any) => String(v ?? '').trim().toUpperCase();
  if (!colisiones.length) return false;
  // 1 principal + hasta 2 adicionales: más de dos choques no caben en un grupo.
  if (colisiones.length > MAX_CURSOS_GRUPO - 1) return false;
  if (!norm(curso.campaign) || !norm(curso.horarioCurso)) return false;
  return colisiones.every(c =>
    norm(c.campaign) === norm(curso.campaign) && norm(c.horarioCurso) === norm(curso.horarioCurso)
  );
}
