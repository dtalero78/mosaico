import 'server-only';
import { query } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';
import { ESTADOS_LIBERAN_CUPO } from '@/lib/cupo-estados';
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario';
import { TIPOS_FUERA_DE_CASOS_SQL } from '@/lib/tipos-sesion';
import { INICIO_CAMPANAS_DOS_BLOQUES, INICIO_DOS_BLOQUES } from '@/lib/bloques-leccion';

/**
 * Académico › Gestión Cursos — tres consultas de sólo lectura.
 *
 * Definiciones (acordadas con el usuario):
 *  - INICIAL: alumnos con agendamiento NO cancelado en la PRIMERA sesión del curso.
 *    Los agendamientos pasados se conservan cuando un alumno sale, así que el que se
 *    retiró sigue contando como inicial.
 *  - CON CUPO: beneficiarios que ocupan cupo hoy (`cupoOcupadoSql`).
 *  - EN PROCESO DE CIERRE ("retirados"): de ésos, los que tienen un caso de Finanzas en
 *    «En Proceso de Cierre». Dejaron de asistir pero siguen ocupando el cupo hasta que
 *    Finanzas cierra el caso.
 *  - EFECTIVOS = con cupo − en proceso de cierre. Es el número que manda: filtro 1-8,
 *    alerta de «3 o menos» y etiqueta Completo/Disminuido.
 *  - CANCELADOS: beneficiarios del salón cuyo contrato quedó anulado (el titular en un
 *    estado que libera el cupo).
 *  - COMPLETO: efectivos ≥ inicial. DISMINUIDO / CON CAMBIO: efectivos < inicial.
 *
 * Sólo cursos vigentes (activos, no cerrados) que YA empezaron; IMPULSA queda fuera.
 */

export const UMBRAL_FUSION = 3;

const LIB = ESTADOS_LIBERAN_CUPO.map(e => `'${e}'`).join(', ');

/** Cursos vigentes con sus conteos. Una fila por salón. */
const CURSOS_CTE = `
  cursos AS (
    SELECT cc."_id" AS "cursoId", cc."campaign", cc."tipoCurso" AS "curso", cc."salon", cc."horarioCurso",
           cc."guia" AS "guiaId", g."nombreCompleto" AS "guia", cc."numeroUsuarios" AS "cupos",
           pe."_id" AS "primeroId"
      FROM "CURSOS_CAMPAIGN" cc
      LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      JOIN LATERAL (
        SELECT c."_id", c."dia" FROM "CALENDARIO" c
         WHERE c."cursoCampaignId" = cc."_id" ORDER BY c."dia" ASC LIMIT 1
      ) pe ON pe."dia" < NOW()
     WHERE cc."activa" = true
       AND UPPER(cc."tipoCurso") <> 'IMPULSA'
       AND (cc."finalCurso" IS NULL OR cc."finalCurso" >= (NOW() AT TIME ZONE 'America/Santiago')::date)
  ),
  stats AS (
    SELECT k.*,
      (SELECT COUNT(DISTINCT COALESCE(b."idEstudiante", b."studentId"))
         FROM "ACADEMICA_BOOKINGS" b
        WHERE (b."eventoId" = k."primeroId" OR b."idEvento" = k."primeroId")
          AND COALESCE(b."cancelo", false) = false)::int AS "inicial",
      (SELECT COUNT(*) FROM "PEOPLE" p
        WHERE p."tipoUsuario" = 'BENEFICIARIO' AND p."campaign" = k."campaign" AND p."tipoCurso" = k."curso"
          AND p."horarioCurso" = k."horarioCurso" AND p."salon" IS NOT DISTINCT FROM k."salon"
          AND ${cupoOcupadoSql('p')})::int AS "conCupo",
      (SELECT COUNT(*) FROM "PEOPLE" p
         JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
        WHERE p."tipoUsuario" = 'BENEFICIARIO' AND p."campaign" = k."campaign" AND p."tipoCurso" = k."curso"
          AND p."horarioCurso" = k."horarioCurso" AND p."salon" IS NOT DISTINCT FROM k."salon"
          AND ${cupoOcupadoSql('p')}
          AND EXISTS (SELECT 1 FROM "CASOS_ATENCION" ca WHERE ca."academicaId" = a."_id" AND ca."estado"::text = 'PROCESO_DE_CIERRE'))::int AS "enCierre",
      (SELECT COUNT(*) FROM "PEOPLE" p
        WHERE p."tipoUsuario" = 'BENEFICIARIO' AND p."campaign" = k."campaign" AND p."tipoCurso" = k."curso"
          AND p."horarioCurso" = k."horarioCurso" AND p."salon" IS NOT DISTINCT FROM k."salon"
          AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
          AND EXISTS (SELECT 1 FROM "PEOPLE" t WHERE t."contrato" = p."contrato" AND t."tipoUsuario" = 'TITULAR'
                       AND LOWER(TRIM(COALESCE(t."aprobacion", ''))) IN (${LIB})))::int AS "cancelados"
      FROM cursos k
  )`;

export interface CursoFila {
  cursoId: string; campaign: string; curso: string; salon: string | null; horarioCurso: string;
  guiaId: string | null; guia: string | null; cupos: number;
  inicial: number; conCupo: number; enCierre: number; efectivos: number; cancelados: number;
  completo: boolean; fusion: boolean;
}

export interface FiltrosCursos {
  campaign?: string; curso?: string; salon?: string; guia?: string;
}

export async function listarCursos(f: FiltrosCursos): Promise<{ filas: CursoFila[]; opciones: { campanias: string[]; cursos: string[]; salones: string[]; guias: Array<{ id: string; nombre: string }> } }> {
  const rows = (await query(
    `WITH ${CURSOS_CTE} SELECT * FROM stats ORDER BY "campaign" DESC, "curso", "salon"`,
  )).rows as any[];

  const filas: CursoFila[] = rows.map(r => {
    const efectivos = Math.max(0, Number(r.conCupo) - Number(r.enCierre));
    const inicial = Number(r.inicial);
    return {
      cursoId: r.cursoId, campaign: r.campaign, curso: r.curso, salon: r.salon, horarioCurso: r.horarioCurso,
      guiaId: r.guiaId, guia: r.guia, cupos: Number(r.cupos) || 0,
      inicial, conCupo: Number(r.conCupo), enCierre: Number(r.enCierre), efectivos, cancelados: Number(r.cancelados),
      completo: efectivos >= inicial,
      fusion: efectivos <= UMBRAL_FUSION,
    };
  });

  const uniq = (a: Array<string | null | undefined>) => Array.from(new Set(a.filter(Boolean) as string[])).sort();
  const opciones = {
    campanias: uniq(filas.map(x => x.campaign)),
    cursos: uniq(filas.map(x => x.curso)),
    salones: uniq(filas.map(x => x.salon)),
    guias: Array.from(new Map(filas.filter(x => x.guiaId).map(x => [x.guiaId!, { id: x.guiaId!, nombre: x.guia || x.guiaId! }])).values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  };

  const filtradas = filas.filter(x =>
    (!f.campaign || x.campaign === f.campaign) &&
    (!f.curso || x.curso === f.curso) &&
    (!f.salon || x.salon === f.salon) &&
    (!f.guia || x.guiaId === f.guia));
  return { filas: filtradas, opciones };
}

/** Opciones de los filtros: los cursos vigentes (consulta liviana, sin conteos). */
export async function opcionesCursos() {
  const r = (await query(
    `SELECT cc."campaign", cc."tipoCurso" AS curso, cc."salon", cc."guia" AS "guiaId", g."nombreCompleto" AS guia
       FROM "CURSOS_CAMPAIGN" cc LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE cc."activa" = true AND UPPER(cc."tipoCurso") <> 'IMPULSA'
        AND (cc."finalCurso" IS NULL OR cc."finalCurso" >= (NOW() AT TIME ZONE 'America/Santiago')::date)`,
  )).rows as any[];
  const uniq = (a: Array<string | null | undefined>) => Array.from(new Set(a.filter(Boolean) as string[])).sort();
  return {
    campanias: uniq(r.map(x => x.campaign)).reverse(), cursos: uniq(r.map(x => x.curso)), salones: uniq(r.map(x => x.salon)),
    guias: Array.from(new Map(r.filter(x => x.guiaId).map(x => [x.guiaId, { id: x.guiaId, nombre: x.guia || x.guiaId }])).values())
      .sort((x: any, y: any) => String(x.nombre).localeCompare(String(y.nombre), 'es')),
  };
}

/** Faltas sin justificar por alumno en el período; sólo con 2 o más. */
export async function listarAusencias(f: {
  campaign?: string; curso?: string; salon?: string; guia?: string; usuario?: string;
  startDate: string; endDate: string;
}) {
  const where: string[] = [
    `COALESCE(b."asistio", false) = false`,
    `COALESCE(b."asistencia", false) = false`,
    `COALESCE(b."cancelo", false) = false`,
    // Las justificadas no cuentan.
    `COALESCE(b."escusa", false) = false`,
    `COALESCE(c."dia", b."fechaEvento") < NOW()`,
    `UPPER(COALESCE(c."tipo", b."tipo", b."tipoEvento", 'SESSION')) NOT IN (${TIPOS_FUERA_DE_CASOS_SQL})`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    `UPPER(p."tipoCurso") <> 'IMPULSA'`,
    `${cupoOcupadoSql('p')}`,
    `COALESCE(c."dia", b."fechaEvento") >= $1::date`,
    `COALESCE(c."dia", b."fechaEvento") < ($2::date + INTERVAL '1 day')`,
  ];
  const params: any[] = [f.startDate, f.endDate];
  let i = 3;
  if (f.campaign) { where.push(`p."campaign" = $${i++}`); params.push(f.campaign); }
  if (f.curso)    { where.push(`p."tipoCurso" = $${i++}`); params.push(f.curso); }
  if (f.salon)    { where.push(`p."salon" = $${i++}`); params.push(f.salon); }
  if (f.guia)     { where.push(`cc."guia" = $${i++}`); params.push(f.guia); }
  if (f.usuario) {
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'p."numeroId"', f.usuario, i, 'p."contrato"');
    where.push(c.sql); params.push(...c.params); i += 2;
  }

  const rows = (await query(
    `SELECT a."_id" AS "academicaId", p."campaign", p."tipoCurso" AS curso, p."salon", p."contrato", p."numeroId",
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            g."nombreCompleto" AS guia,
            -- Un sábado de dos lecciones (campañas desde agosto, desde el 21-ago) cuenta dos.
            SUM(CASE WHEN p."horarioCurso" ~* '^S[ÁA]B' AND cc."inicioCurso" >= DATE '${INICIO_CAMPANAS_DOS_BLOQUES}'
                      AND COALESCE(c."dia", b."fechaEvento") >= DATE '${INICIO_DOS_BLOQUES}' THEN 2 ELSE 1 END)::int AS "ausencias",
            MAX(COALESCE(c."dia", b."fechaEvento")) AS "ultima"
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ${where.join(' AND ')}
      GROUP BY a."_id", p."campaign", p."tipoCurso", p."salon", p."contrato", p."numeroId", nombre, g."nombreCompleto"
     HAVING SUM(CASE WHEN p."horarioCurso" ~* '^S[ÁA]B' AND cc."inicioCurso" >= DATE '${INICIO_CAMPANAS_DOS_BLOQUES}'
                      AND COALESCE(c."dia", b."fechaEvento") >= DATE '${INICIO_DOS_BLOQUES}' THEN 2 ELSE 1 END) >= 2
      ORDER BY "ausencias" DESC, nombre ASC
      LIMIT 3000`,
    params,
  )).rows as any[];

  return { rows, opciones: await opcionesCursos() };
}
