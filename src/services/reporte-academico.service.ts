import 'server-only';
import { query, queryOne } from '@/lib/postgres';

/**
 * Reporte Académico — consolida por SALÓN y SEMANA las métricas que el Guía marca
 * a cada estudiante en sus sesiones (Hábitos / Desempeño / Actitudes), la
 * asistencia acumulada del curso, el progreso, los comentarios del Guía y las
 * notas guardadas (comentario IA + valoración del Guía).
 *
 * RBAC: un usuario con rol GUIA solo ve SUS cursos (CURSOS_CAMPAIGN.guia); un
 * admin (o quien tenga el permiso) elige el Guía en el filtro.
 */

export interface ReporteFiltros {
  guia?: string; curso?: string; salon?: string; campaign?: string;
  startDate?: string; endDate?: string;
}

// key ↔ columna(s) ↔ label. Orden = orden en la tabla (3 grupos de 3).
export const METRICAS = [
  { key: 'asistio', label: 'Asistió', grupo: 'HÁBITOS', expr: '(COALESCE(b."asistio",false) OR COALESCE(b."asistencia",false))' },
  { key: 'puntual', label: 'Puntual', grupo: 'HÁBITOS', expr: 'COALESCE(b."hePuntualidad",false)' },
  { key: 'asignacion', label: 'Asignación', grupo: 'HÁBITOS', expr: 'COALESCE(b."heAsignacion",false)' },
  { key: 'dominio', label: 'Dominio', grupo: 'DESEMPEÑO', expr: 'COALESCE(b."daDominio",false)' },
  { key: 'participo', label: 'Participó', grupo: 'DESEMPEÑO', expr: 'COALESCE(b."participacion",false)' },
  { key: 'desafio', label: 'Desafío', grupo: 'DESEMPEÑO', expr: 'COALESCE(b."daDesafio",false)' },
  { key: 'activo', label: 'Activo', grupo: 'ACTITUDES', expr: 'COALESCE(b."acPermanencia",false)' },
  { key: 'respeto', label: 'Respeto', grupo: 'ACTITUDES', expr: 'COALESCE(b."acRespeto",false)' },
  { key: 'camara', label: 'Cámara', grupo: 'ACTITUDES', expr: 'COALESCE(b."acDisposicion",false)' },
] as const;

// Tipos que NO cuentan como "sesión" para las métricas semanales / asistencia del curso.
const NO_SESION = `UPPER(COALESCE(b."tipo", b."tipoEvento", 'SESSION')) NOT IN ('CLUB','NIVELACION','COMPLEMENTARIA','WELCOME','OLIMPIADA')`;

/** Lunes (inicio) y domingo (fin, exclusivo=lunes siguiente) de la semana de `d`. */
function semanaDe(d: Date): { inicio: string; finExcl: string } {
  const day = (d.getUTCDay() + 6) % 7; // 0 = lunes
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const next = new Date(monday); next.setUTCDate(monday.getUTCDate() + 7);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { inicio: iso(monday), finExcl: iso(next) };
}

/** Estado del óvalo de una métrica según cumplidas / sesiones de la semana. */
export function ovalo(cumplidas: number, sesiones: number): 'full' | 'half' | 'empty' | 'none' {
  if (!sesiones) return 'none';
  if (cumplidas >= sesiones) return 'full';
  if (cumplidas > 0) return 'half';
  return 'empty';
}

async function resolverGuiaDeSesion(session: any): Promise<string | null> {
  const email = session?.user?.email;
  if (!email) return null;
  const g = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "GUIAS" WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`, [email]
  );
  return g?._id || null;
}

export async function getReporteAcademico(filtros: ReporteFiltros, session: any) {
  const rol = session?.user?.role || '';
  const esGuia = rol === 'GUIA';

  // Scope de guía: un GUIA queda forzado a su propio _id.
  let guiaScope: string | null = null;
  if (esGuia) {
    guiaScope = await resolverGuiaDeSesion(session);
    if (!guiaScope) {
      return { available: false, motivo: 'Tu usuario no está registrado como Guía.', rows: [], guias: [], cursos: [], salones: [] };
    }
  } else if (filtros.guia) {
    guiaScope = filtros.guia;
  }

  // Catálogo de cursos (para dropdowns), acotado al guía si aplica.
  const cwhere: string[] = [`"activa" = true`]; const cparams: any[] = [];
  if (guiaScope) { cwhere.push(`"guia" = $${cparams.length + 1}`); cparams.push(guiaScope); }
  const cursosCampaign = (await query<{ campaign: string; tipoCurso: string; salon: string; guia: string }>(
    `SELECT DISTINCT "campaign","tipoCurso","salon","guia" FROM "CURSOS_CAMPAIGN"
      WHERE ${cwhere.join(' AND ')} ORDER BY "campaign","tipoCurso","salon"`, cparams
  )).rows;

  // Dropdown de guías (para admin: todos; para GUIA: solo el suyo).
  const guias = (await query<{ id: string; nombre: string }>(
    esGuia
      ? `SELECT g."_id" AS id, g."nombreCompleto" AS nombre FROM "GUIAS" g WHERE g."_id" = $1`
      : `SELECT DISTINCT g."_id" AS id, g."nombreCompleto" AS nombre FROM "CURSOS_CAMPAIGN" cc JOIN "GUIAS" g ON g."_id"=cc."guia" WHERE cc."activa"=true AND cc."guia" IS NOT NULL ORDER BY nombre`,
    esGuia ? [guiaScope] : []
  )).rows;

  const cursos = Array.from(new Set(cursosCampaign.map(c => c.tipoCurso)));
  // Curso/salón objetivo: de los filtros, o el primero disponible del scope.
  const curso = filtros.curso || cursos[0] || '';
  const salones = Array.from(new Set(cursosCampaign.filter(c => !curso || c.tipoCurso === curso).map(c => c.salon)));
  const salon = filtros.salon || salones[0] || '';
  const guiaCurso = cursosCampaign.find(c => c.tipoCurso === curso && c.salon === salon)?.guia
    || cursosCampaign.find(c => c.tipoCurso === curso)?.guia || guiaScope || null;
  const guiaNombre = guias.find(g => g.id === guiaCurso)?.nombre || guias[0]?.nombre || '';

  // Semana (default: actual). endDate se usa para ubicar la semana.
  const base = filtros.endDate ? new Date(filtros.endDate + 'T12:00:00Z')
    : filtros.startDate ? new Date(filtros.startDate + 'T12:00:00Z') : new Date();
  const { inicio, finExcl } = semanaDe(base);

  if (!curso || !salon) {
    return { available: true, rows: [], guias, cursos, salones, curso, salon, guiaNombre, semanaInicio: inicio, semanaFin: finExcl, sinCurso: true };
  }

  // Agregados por métrica (cumplidas en la semana).
  const metricAgg = METRICAS.map(m =>
    `COUNT(*) FILTER (WHERE ${m.expr}) AS "c_${m.key}"`).join(',\n            ');

  const sql = `
    SELECT
      p."_id" AS "peopleId", p."numeroId",
      TRIM(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido")) AS "nombre",
      p."plataforma", p."apoderado", p."apoderadoTelefono",
      acad."academicaId", acad."nivel", acad."step",
      sem."sesSemana", ${METRICAS.map(m => `sem."c_${m.key}"`).join(', ')},
      sem."comentariosSemana",
      cur."totalCurso", cur."asistidasCurso",
      prog."ordenActual", prog."ordenMax",
      nota."comentarioIA", nota."notaGuia"
    FROM "PEOPLE" p
    LEFT JOIN LATERAL (
      SELECT a."_id" AS "academicaId", a."nivel", a."step"
      FROM "ACADEMICA" a WHERE a."numeroId" = p."numeroId"
      ORDER BY (a."tipoUsuario" = 'BENEFICIARIO') DESC LIMIT 1
    ) acad ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE COALESCE(b."cancelo",false)=false) AS "sesSemana",
             ${metricAgg},
             string_agg(NULLIF(TRIM(b."comentarios"),''), ' | ') AS "comentariosSemana"
      FROM "ACADEMICA_BOOKINGS" b
      WHERE b."idEstudiante" = acad."academicaId"
        AND b."fechaEvento" >= $2 AND b."fechaEvento" < $3
        AND COALESCE(b."cancelo",false)=false AND ${NO_SESION}
    ) sem ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE COALESCE(b."cancelo",false)=false) AS "totalCurso",
             COUNT(*) FILTER (WHERE (COALESCE(b."asistio",false) OR COALESCE(b."asistencia",false)) AND COALESCE(b."cancelo",false)=false) AS "asistidasCurso"
      FROM "ACADEMICA_BOOKINGS" b
      WHERE b."idEstudiante" = acad."academicaId" AND ${NO_SESION}
    ) cur ON true
    LEFT JOIN LATERAL (
      SELECT (SELECT n."orden" FROM "NIVELES" n WHERE UPPER(n."curso")=UPPER(p."tipoCurso") AND n."code"=acad."nivel" AND n."step"=acad."step" LIMIT 1) AS "ordenActual",
             (SELECT MAX(n2."orden") FROM "NIVELES" n2 WHERE UPPER(n2."curso")=UPPER(p."tipoCurso")) AS "ordenMax"
    ) prog ON true
    LEFT JOIN "REPORTE_ACADEMICO_NOTAS" nota
      ON nota."academicaId" = acad."academicaId" AND nota."salon" = $4 AND nota."semanaInicio" = $2
    WHERE p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
      AND UPPER(p."tipoCurso") = UPPER($1) AND p."salon" = $4
      ${filtros.campaign ? 'AND p."campaign" = $5' : ''}
    ORDER BY p."primerApellido" NULLS LAST, p."primerNombre" NULLS LAST`;

  const params: any[] = [curso, inicio, finExcl, salon];
  if (filtros.campaign) params.push(filtros.campaign);
  const rows = (await query<any>(sql, params)).rows;

  const out = rows.map((r) => {
    const ses = Number(r.sesSemana) || 0;
    const metricas: Record<string, { cumplidas: number; sesiones: number; estado: string }> = {};
    for (const m of METRICAS) {
      const c = Number(r[`c_${m.key}`]) || 0;
      metricas[m.key] = { cumplidas: c, sesiones: ses, estado: ovalo(c, ses) };
    }
    const totalCurso = Number(r.totalCurso) || 0;
    const asistidasCurso = Number(r.asistidasCurso) || 0;
    const ordenActual = Number(r.ordenActual) || 0;
    const ordenMax = Number(r.ordenMax) || 0;
    return {
      academicaId: r.academicaId, peopleId: r.peopleId, numeroId: r.numeroId,
      nombre: r.nombre || '(sin nombre)', plataforma: r.plataforma || '',
      apoderado: r.apoderado || '', apoderadoTelefono: r.apoderadoTelefono || '',
      nivel: r.nivel || '', step: r.step || '',
      sesSemana: ses, metricas,
      asistidasCurso, totalCurso,
      asistenciaCursoPct: totalCurso ? Math.round((asistidasCurso / totalCurso) * 100) : 0,
      progresoPct: ordenMax ? Math.round((ordenActual / ordenMax) * 100) : 0,
      comentariosSemana: r.comentariosSemana || '',
      comentarioIA: r.comentarioIA || '',
      notaGuia: r.notaGuia || '',
    };
  });

  // Resumen
  const totalSesSemana = out.reduce((a, r) => a + r.sesSemana, 0);
  const asistidasSemana = out.reduce((a, r) => a + (r.metricas.asistio?.cumplidas || 0), 0);

  return {
    available: true, rows: out, guias, cursos, salones,
    curso, salon, campaign: filtros.campaign || '', guiaNombre,
    semanaInicio: inicio, semanaFin: finExcl,
    resumen: {
      estudiantes: out.length,
      asistidasSemana, totalSesSemana,
      asistenciaSemanaPct: totalSesSemana ? Math.round((asistidasSemana / totalSesSemana) * 100) : 0,
      asistenciaCursoPct: (() => {
        const t = out.reduce((a, r) => a + r.totalCurso, 0);
        const as = out.reduce((a, r) => a + r.asistidasCurso, 0);
        return t ? Math.round((as / t) * 100) : 0;
      })(),
      progresoPct: out.length ? Math.round(out.reduce((a, r) => a + r.progresoPct, 0) / out.length) : 0,
    },
  };
}
