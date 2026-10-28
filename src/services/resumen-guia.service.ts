import 'server-only';
import { queryOne } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';
import { estadoCurso } from '@/lib/cursos-campaign';
import { deriveCuestionarios } from '@/lib/cuestionarios';
import { METRICAS_MANUALES } from '@/lib/criterios-guia';
import {
  claveLeccion, esLeccionEvaluacion, construirFilas, resumirCurso, normTexto,
  type AlumnoCrudo, type CursoCrudo, type FilaResumenAlumno, type ResumenCurso,
} from '@/lib/resumen-guia';

/**
 * Panel del guía — "Mis alumnos por curso".
 *
 * UNA consulta por carga: trae los cursos vigentes del guía, sus alumnos (los que
 * ocupan cupo), los agendamientos de las clases ya ocurridas de cada curso, sus
 * casos, evaluaciones, correcciones de criterios y la estructura del programa.
 * Todo se agrega con CTEs agrupadas (sin subconsultas por fila) y vuelve en una
 * sola fila de JSON. El cálculo y las alertas viven en `lib/resumen-guia` y
 * `lib/reglas-alertas-guia`, puros y probados.
 *
 * Sólo lectura. El ALCANCE (qué guía puede ver quién) lo decide la ruta API.
 */

export interface CursoResumenGuia {
  cursoId: string;
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  salon: string | null;
  inicioCurso: string | null;
  finalCurso: string | null;
  numeroUsuarios: number;
  resumen: ResumenCurso;
  filas: FilaResumenAlumno[];
}

export interface ResumenGuia {
  guia: { id: string; nombre: string | null };
  corte: string;
  cursos: CursoResumenGuia[];
}

// La rúbrica viaja con la clave del criterio, no con el nombre de la columna.
const CRITERIOS_JSON = METRICAS_MANUALES
  .map(m => `'${m.key}', b."${m.col}"`)
  .join(', ');

const SQL = `
WITH cursos AS (
  SELECT cc."_id" AS "cursoId", cc."campaign", cc."tipoCurso", cc."horarioCurso", cc."salon",
         cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso",
         COALESCE(cc."numeroUsuarios", 0) AS "numeroUsuarios"
    FROM "CURSOS_CAMPAIGN" cc
   WHERE cc."guia" = $1 AND cc."activa" = true
),
-- Inicio de la CAMPAÑA (su primer curso, de cualquier guía): lo usa estadoCurso.
camp AS (
  SELECT x."campaign", MIN(x."inicioCurso")::text AS "inicioCampanaCursos"
    FROM "CURSOS_CAMPAIGN" x
   WHERE x."campaign" IN (SELECT "campaign" FROM cursos)
   GROUP BY x."campaign"
),
alumnos AS (
  SELECT k."cursoId", p."_id" AS "peopleId", p."numeroId",
         p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"
    FROM cursos k
    JOIN "PEOPLE" p
      ON p."tipoUsuario" = 'BENEFICIARIO'
     AND p."campaign" = k."campaign" AND p."tipoCurso" = k."tipoCurso" AND p."horarioCurso" = k."horarioCurso" AND p."salon" IS NOT DISTINCT FROM k."salon"
   WHERE ${cupoOcupadoSql('p')}
),
acad AS (
  SELECT DISTINCT ON (a."numeroId")
         a."numeroId", a."_id" AS "academicaId", a."NivelacionHistory",
         (COALESCE(a."nivelacion", false) OR COALESCE(a."aprobadoNivelacion", false)) AS "nivelacionViva"
    FROM "ACADEMICA" a
   WHERE a."numeroId" IN (SELECT "numeroId" FROM alumnos)
   ORDER BY a."numeroId", (a."tipoUsuario" = 'BENEFICIARIO') DESC, a."_id"
),
eventos AS (
  SELECT c."_id", c."cursoCampaignId", c."dia", c."sesionModulo", c."sesionLeccion",
         c."sesionModulo2", c."sesionLeccion2", c."sesionCerrada",
         (c."motivoCierre" = 'CARGA_HISTORICA') AS "carga"
    FROM "CALENDARIO" c
   WHERE c."cursoCampaignId" IN (SELECT "cursoId" FROM cursos)
     AND c."dia" <= NOW()
),
bk AS (
  SELECT b."studentId" AS "academicaId", e."cursoCampaignId" AS "cursoId",
         json_agg(json_build_object(
           'dia', e."dia", 'sm', e."sesionModulo", 'sl', e."sesionLeccion",
           'sm2', e."sesionModulo2", 'sl2', e."sesionLeccion2", 'cerrada', e."sesionCerrada",
           'carga', COALESCE(e."carga", false),
           'asistio', b."asistio", 'asistencia', b."asistencia", 'cancelo', b."cancelo",
           'noAprobo', b."noAprobo", 'escusa', b."escusa", 'rubrica', b."rubricaEvaluada",
           'crit', json_build_object(${CRITERIOS_JSON})
         ) ORDER BY e."dia") AS "bookings"
    FROM "ACADEMICA_BOOKINGS" b
    JOIN eventos e ON e."_id" = b."eventoId"
   WHERE b."studentId" IN (SELECT "academicaId" FROM acad)
   GROUP BY b."studentId", e."cursoCampaignId"
),
casos AS (
  SELECT ca."academicaId", json_agg(json_build_object('estado', ca."estado", 'abiertoEn', ca."abiertoEn")) AS "casos"
    FROM "CASOS_ATENCION" ca
   WHERE ca."academicaId" IN (SELECT "academicaId" FROM acad)
   GROUP BY ca."academicaId"
),
evals AS (
  SELECT er."academicaId", json_agg(json_build_object(
           'curso', er."curso", 'code', er."code", 'step', er."step",
           'cuestionarioId', er."cuestionarioId", 'porcentaje', er."porcentaje")) AS "evals"
    FROM "EVALUACION_RESPUESTAS" er
   WHERE er."academicaId" IN (SELECT "academicaId" FROM acad)
   GROUP BY er."academicaId"
),
notas AS (
  SELECT n."academicaId", json_agg(json_build_object(
           'salon', n."salon", 'campaign', n."campaign",
           'semanaInicio', n."semanaInicio", 'criterios', n."criterios")) AS "notas"
    FROM "REPORTE_ACADEMICO_NOTAS" n
   WHERE n."academicaId" IN (SELECT "academicaId" FROM acad)
     AND n."criterios" IS NOT NULL
   GROUP BY n."academicaId"
),
programa AS (
  SELECT nv."curso", nv."code", nv."step", nv."cuestionarios", nv."preguntasManual", nv."evaluacionModo"
    FROM "NIVELES" nv
   WHERE nv."curso" IN (SELECT "tipoCurso" FROM cursos)
)
SELECT
  (SELECT "nombreCompleto" FROM "GUIAS" WHERE "_id" = $1) AS "guiaNombre",
  (SELECT json_agg(json_build_object(
     'cursoId', k."cursoId", 'campaign', k."campaign", 'tipoCurso', k."tipoCurso",
     'horarioCurso', k."horarioCurso", 'salon', k."salon",
     'inicioCurso', k."inicioCurso", 'finalCurso', k."finalCurso",
     'inicioCampanaCursos', cp."inicioCampanaCursos", 'numeroUsuarios', k."numeroUsuarios")
     -- Mismo orden que Cursos asignados.
     ORDER BY k."campaign",
       CASE k."tipoCurso" WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
                          WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END,
       k."salon", k."horarioCurso")
     FROM cursos k LEFT JOIN camp cp ON cp."campaign" = k."campaign") AS "cursos",
  (SELECT json_agg(json_build_object(
     'cursoId', e."cursoCampaignId", 'dia', e."dia", 'sm', e."sesionModulo", 'sl', e."sesionLeccion",
     'sm2', e."sesionModulo2", 'sl2', e."sesionLeccion2", 'carga', COALESCE(e."carga", false)))
     FROM eventos e) AS "eventos",
  (SELECT json_agg(json_build_object(
     'cursoId', al."cursoId", 'peopleId', al."peopleId", 'academicaId', ac."academicaId",
     'numeroId', al."numeroId",
     'primerNombre', al."primerNombre", 'segundoNombre', al."segundoNombre",
     'primerApellido', al."primerApellido", 'segundoApellido', al."segundoApellido",
     'nivelacionHistory', ac."NivelacionHistory", 'nivelacionViva', COALESCE(ac."nivelacionViva", false),
     'bookings', COALESCE(bk."bookings", '[]'::json),
     'casos', COALESCE(cs."casos", '[]'::json),
     'evals', COALESCE(ev."evals", '[]'::json),
     'notas', COALESCE(nt."notas", '[]'::json)))
     FROM alumnos al
     LEFT JOIN acad ac ON ac."numeroId" = al."numeroId"
     LEFT JOIN bk ON bk."academicaId" = ac."academicaId" AND bk."cursoId" = al."cursoId"
     LEFT JOIN casos cs ON cs."academicaId" = ac."academicaId"
     LEFT JOIN evals ev ON ev."academicaId" = ac."academicaId"
     LEFT JOIN notas nt ON nt."academicaId" = ac."academicaId") AS "alumnos",
  (SELECT json_agg(json_build_object(
     'curso', pr."curso", 'code', pr."code", 'step', pr."step",
     'cuestionarios', pr."cuestionarios", 'preguntasManual', pr."preguntasManual",
     'evaluacionModo', pr."evaluacionModo"))
     FROM programa pr) AS "programa"
`;

const arr = (x: any): any[] => (Array.isArray(x) ? x : []);

export async function getResumenGuia(guiaId: string, now: Date = new Date()): Promise<ResumenGuia> {
  const row = await queryOne<any>(SQL, [guiaId]);
  const cursosRaw = arr(row?.cursos)
    // "Curso activo": los que ya terminaron no van en las pestañas.
    .filter((c: any) => estadoCurso(c, now) !== 'cerrado');
  const eventos = arr(row?.eventos);
  const alumnos = arr(row?.alumnos);
  const programa = arr(row?.programa);

  const cursos: CursoResumenGuia[] = cursosRaw.map((c: any) => {
    // Estructura del programa de ESTE curso: lecciones (sin evaluaciones) y
    // los cuestionarios de cada lección de evaluación.
    const delCurso = programa.filter((p: any) => normTexto(p.curso) === normTexto(c.tipoCurso));
    const lecciones = new Set<string>();
    const cuestionariosEval: Record<string, string[]> = {};
    for (const p of delCurso) {
      const k = claveLeccion(p.code, p.step);
      if (esLeccionEvaluacion(p.code, p.step)) {
        const ids = deriveCuestionarios(p).map(q => q.id);
        if (ids.length) cuestionariosEval[k] = ids;
      } else if (normTexto(p.step) !== 'welcome') {
        lecciones.add(k);
      }
    }

    const curso: CursoCrudo = {
      cursoId: c.cursoId, campaign: c.campaign, tipoCurso: c.tipoCurso, horarioCurso: c.horarioCurso,
      salon: c.salon ?? null, inicioCurso: c.inicioCurso ?? null, finalCurso: c.finalCurso ?? null,
      inicioCampanaCursos: c.inicioCampanaCursos ?? null, numeroUsuarios: Number(c.numeroUsuarios) || 0,
      eventosPasados: eventos.filter((e: any) => e.cursoId === c.cursoId),
      leccionesPrograma: lecciones.size,
      cuestionariosEval,
    };

    const susAlumnos: AlumnoCrudo[] = alumnos
      .filter((a: any) => a.cursoId === c.cursoId)
      .map((a: any) => ({
        peopleId: a.peopleId, academicaId: a.academicaId ?? null, numeroId: a.numeroId ?? null,
        primerNombre: a.primerNombre ?? null, segundoNombre: a.segundoNombre ?? null,
        primerApellido: a.primerApellido ?? null, segundoApellido: a.segundoApellido ?? null,
        nivelacionHistory: arr(a.nivelacionHistory),
        nivelacionViva: a.nivelacionViva === true,
        bookings: arr(a.bookings), casos: arr(a.casos), evals: arr(a.evals), notas: arr(a.notas),
      }));

    const filas = construirFilas(susAlumnos, curso, now);
    return {
      cursoId: curso.cursoId, campaign: curso.campaign, tipoCurso: curso.tipoCurso,
      horarioCurso: curso.horarioCurso, salon: curso.salon,
      inicioCurso: curso.inicioCurso, finalCurso: curso.finalCurso, numeroUsuarios: curso.numeroUsuarios,
      resumen: resumirCurso(filas, curso),
      filas,
    };
  });

  return { guia: { id: guiaId, nombre: row?.guiaNombre ?? null }, corte: now.toISOString(), cursos };
}
