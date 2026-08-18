import 'server-only';
import { query } from '@/lib/postgres';
import { horariosSeSolapan } from '@/lib/cursos-campaign';
// La regla de «hay guía asignado» vive en lib/ para que la puedan usar también
// los scripts y los tests; se reexporta para no cambiar a quien la importe de aquí.
import { guiaAsignado } from '@/lib/guia';
export { guiaAsignado };

/**
 * Colisiones de horario de un GUÍA entre cursos de campaña.
 *
 * Un guía no puede dictar dos cursos a la vez: al asignarlo a un curso se
 * verifica que no tenga otro, en NINGUNA campaña activa, que comparta día y se
 * solape en el horario mientras ambos están vigentes.
 *
 * Tres condiciones, todas necesarias:
 *   1. Mismo guía y el otro curso `activa = true`.
 *   2. Los horarios se pisan — comparten día de la semana y sus rangos se
 *      solapan (`horariosSeSolapan`; terminar cuando el otro empieza NO choca).
 *   3. Las VIGENCIAS se solapan: dos cursos con el mismo horario pero en
 *      periodos distintos (uno termina antes de que el otro empiece) no chocan
 *      — es justo cómo se encadenan las campañas.
 *
 * Se compara en JS y no en SQL porque el horario es un texto del catálogo
 * ("LUN-MIÉ 17:00-18:00") y los días viven dentro de esa cadena.
 */
export interface CursoParaColision {
  /** `_id` del curso que se está creando/editando; se excluye de la búsqueda. */
  excluirId?: string | null;
  /**
   * El alta de cursos hace UPSERT por (campaign, tipoCurso, horarioCurso), así
   * que al re-guardar un curso existente hay que excluirlo por su clave natural
   * — si no, chocaría CONSIGO MISMO.
   */
  excluirClaveNatural?: boolean;
  guia?: string | null;
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  salon?: string | null;
  inicioCurso?: string | null;
  finalCurso?: string | null;
  /**
   * Grupo de salón al que pertenece este curso. Dos cursos del MISMO grupo
   * comparten guía y horario **a propósito** (el guía dicta una sola sesión para
   * los alumnos de ambos), así que no son una colisión: se excluyen del choque.
   */
  grupoHorarioId?: string | null;
}

export interface ColisionGuia {
  _id: string;
  campaign: string;
  tipoCurso: string;
  salon: string | null;
  horarioCurso: string;
  inicioCurso: string | null;
  finalCurso: string | null;
  guiaNombre: string | null;
  /** Grupo de salón del curso con el que se choca (null = no está agrupado). */
  grupoHorarioId: string | null;
  /** true si no se pudo comparar la vigencia por falta de fechas (se reporta igual). */
  vigenciaIndeterminada: boolean;
}

const soloFecha = (v: any): string | null => (v ? String(v).slice(0, 10) : null);


/**
 * ¿Se solapan dos periodos [aIni,aFin] y [bIni,bFin]?
 * Si a alguno le faltan fechas no se puede descartar el choque → se considera
 * que sí se solapan (conservador: preferimos avisar de más que dejar pasar un
 * cruce real), y el llamador lo marca como `vigenciaIndeterminada`.
 */
function vigenciasSeSolapan(aIni: string | null, aFin: string | null, bIni: string | null, bFin: string | null) {
  if (!aIni || !aFin || !bIni || !bFin) return { solapan: true, indeterminada: true };
  return { solapan: aIni <= bFin && bIni <= aFin, indeterminada: false };
}

/**
 * ¿Chocan estos dos cursos? Regla pura, sin tocar la BD: mismo guía + horarios
 * que se pisan + vigencias que se solapan, y que NO sean hermanos del mismo
 * grupo de salón (esos comparten guía y hora a propósito).
 *
 * Se expone para poder revisar una campaña entera con UNA sola consulta:
 * `detectarColisionesGuia` pega a la BD por curso, lo que en una campaña de 28
 * cursos costaba 21 s.
 */
export function chocanCursos(
  a: Pick<CursoParaColision, 'guia' | 'horarioCurso' | 'inicioCurso' | 'finalCurso' | 'grupoHorarioId'>,
  b: Pick<CursoParaColision, 'guia' | 'horarioCurso' | 'inicioCurso' | 'finalCurso' | 'grupoHorarioId'>
): { choca: boolean; vigenciaIndeterminada: boolean } {
  const no = { choca: false, vigenciaIndeterminada: false };
  const guiaA = guiaAsignado(a.guia);
  const guiaB = guiaAsignado(b.guia);
  if (!guiaA || !guiaB || guiaA !== guiaB) return no;
  if (!a.horarioCurso || !b.horarioCurso) return no;

  const grupoA = String(a.grupoHorarioId || '').trim();
  const grupoB = String(b.grupoHorarioId || '').trim();
  if (grupoA && grupoA === grupoB) return no;   // salones unidos a propósito

  if (!horariosSeSolapan(a.horarioCurso, b.horarioCurso)) return no;
  const { solapan, indeterminada } = vigenciasSeSolapan(
    soloFecha(a.inicioCurso), soloFecha(a.finalCurso),
    soloFecha(b.inicioCurso), soloFecha(b.finalCurso)
  );
  return solapan ? { choca: true, vigenciaIndeterminada: indeterminada } : no;
}

export async function detectarColisionesGuia(curso: CursoParaColision): Promise<ColisionGuia[]> {
  const guia = guiaAsignado(curso.guia);
  if (!guia) return [];               // sin guía asignado no hay nada que chocar
  if (!curso.horarioCurso) return [];

  // El guía tiene que ESTAR en la lista de guías. Un id que no resuelve no es una
  // persona a la que se le puedan solapar dos clases: es un dato suelto, y avisar
  // por él sólo bloquea el guardado sin motivo. `INNER JOIN` en vez de `LEFT`, así
  // que si el id no existe la consulta no devuelve candidatos.
  const candidatos = (await query<any>(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
            cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso",
            cc."grupoHorarioId", g."nombreCompleto" AS "guiaNombre"
       FROM "CURSOS_CAMPAIGN" cc
       JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE cc."guia" = $1
        AND cc."activa" = true
        AND ($2::text IS NULL OR cc."_id" <> $2)`,
    [guia, curso.excluirId || null]
  )).rows;

  const iniA = soloFecha(curso.inicioCurso);
  const finA = soloFecha(curso.finalCurso);

  const grupoPropio = String(curso.grupoHorarioId || '').trim();

  const colisiones: ColisionGuia[] = [];
  for (const c of candidatos) {
    // El propio curso, identificado por su clave natural (caso UPSERT).
    if (curso.excluirClaveNatural
      && c.campaign === curso.campaign
      && c.tipoCurso === curso.tipoCurso
      && c.horarioCurso === curso.horarioCurso) continue;
    // Hermanos del mismo grupo de salón: comparten guía y horario A PROPÓSITO.
    if (grupoPropio && String(c.grupoHorarioId || '').trim() === grupoPropio) continue;
    if (!horariosSeSolapan(curso.horarioCurso, c.horarioCurso)) continue;
    const { solapan, indeterminada } = vigenciasSeSolapan(iniA, finA, soloFecha(c.inicioCurso), soloFecha(c.finalCurso));
    if (!solapan) continue;
    colisiones.push({
      _id: c._id,
      campaign: c.campaign,
      tipoCurso: c.tipoCurso,
      salon: c.salon,
      horarioCurso: c.horarioCurso,
      inicioCurso: soloFecha(c.inicioCurso),
      finalCurso: soloFecha(c.finalCurso),
      guiaNombre: c.guiaNombre || null,
      grupoHorarioId: c.grupoHorarioId || null,
      vigenciaIndeterminada: indeterminada,
    });
  }
  return colisiones;
}

/** Mensaje de una colisión, listo para mostrar al usuario. */
export function describirColision(c: ColisionGuia): string {
  const salon = c.salon ? ` · ${c.salon}` : '';
  const vig = c.inicioCurso && c.finalCurso ? ` (${c.inicioCurso} → ${c.finalCurso})` : '';
  return `${c.campaign} · ${c.tipoCurso}${salon} · ${c.horarioCurso}${vig}`;
}

/** Texto completo del error cuando el guía ya está ocupado a esa hora. */
export function mensajeColision(colisiones: ColisionGuia[]): string {
  const nombre = colisiones[0]?.guiaNombre || 'El guía';
  return `${nombre} ya tiene otro curso a esa hora: ${colisiones.map(describirColision).join(' | ')}.`;
}
