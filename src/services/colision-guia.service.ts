import 'server-only';
import { query } from '@/lib/postgres';
import { horariosSeSolapan } from '@/lib/cursos-campaign';

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

export async function detectarColisionesGuia(curso: CursoParaColision): Promise<ColisionGuia[]> {
  const guia = String(curso.guia || '').trim();
  if (!guia) return [];               // sin guía asignado no hay nada que chocar
  if (!curso.horarioCurso) return [];

  const candidatos = (await query<any>(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
            cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso",
            g."nombreCompleto" AS "guiaNombre"
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE cc."guia" = $1
        AND cc."activa" = true
        AND ($2::text IS NULL OR cc."_id" <> $2)`,
    [guia, curso.excluirId || null]
  )).rows;

  const iniA = soloFecha(curso.inicioCurso);
  const finA = soloFecha(curso.finalCurso);

  const colisiones: ColisionGuia[] = [];
  for (const c of candidatos) {
    // El propio curso, identificado por su clave natural (caso UPSERT).
    if (curso.excluirClaveNatural
      && c.campaign === curso.campaign
      && c.tipoCurso === curso.tipoCurso
      && c.horarioCurso === curso.horarioCurso) continue;
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
