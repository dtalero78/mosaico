import 'server-only';
import { query } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { regenerarCursoPreservandoEstado } from './cursos-campaign-eventos.service';

/**
 * Suspender Sesiones (Académico › Sesiones › Suspende Sesión).
 *
 * Suspende un día-clase de un curso/salón: ese día NO se dicta y la sesión se
 * corre al FINAL del curso, para TODOS los alumnos de ese salón (el nº total de
 * clases se conserva).
 *
 * Mecánica: la fecha se registra en CURSOS_SUSPENSIONES y el generador de eventos
 * la descuenta igual que a un festivo de Chile; después se regenera el curso
 * preservando la asistencia ya tomada. Por eso NO se toca
 * CURSOS_CAMPAIGN.finalCurso: es la ventana nominal con la que se cuenta el nº de
 * sesiones — si se extendiera, cada regeneración añadiría una sesión de más. El
 * fin real del curso es la fecha del último evento (`ultimaSesion`).
 */

export interface SesionFiltro {
  guias?: string[];      // GUIAS._id — vacío = todas
  cursos?: string[];     // tipoCurso — vacío = todos
  salones?: string[];    // CURSOS_CAMPAIGN._id (el salón identifica al curso) — vacío = todos
  campaign?: string | null;
  fecha?: string | null;      // YYYY-MM-DD — un día puntual
  fechaHasta?: string | null; // opcional: rango
}

export interface SesionRow {
  eventoId: string;
  cursoCampaignId: string;
  campaign: string;
  tipoCurso: string;
  salon: string | null;
  horarioCurso: string;
  guiaId: string | null;
  guiaNombre: string | null;
  fecha: string;      // YYYY-MM-DD
  hora: string;       // HH:MM
  nivel: string | null;
  step: string | null;
  inscritos: number;
  /** Asistencia ya marcada en esa sesión: suspenderla la borraría. */
  conAsistencia: number;
}

function inClause(vals: string[] | undefined, col: string, params: any[]): string {
  if (!vals || vals.length === 0) return '';
  params.push(vals);
  return ` AND ${col} = ANY($${params.length})`;
}

/** Sesiones futuras que cumplen el filtro. */
export async function listarSesiones(f: SesionFiltro): Promise<SesionRow[]> {
  const params: any[] = [];
  let sql = `
    SELECT c."_id" AS "eventoId", c."cursoCampaignId",
           cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso", cc."guia" AS "guiaId",
           g."nombreCompleto" AS "guiaNombre",
           (c."dia" AT TIME ZONE 'America/Santiago')::date::text AS "fecha",
           TO_CHAR(c."dia" AT TIME ZONE 'America/Santiago', 'HH24:MI') AS "hora",
           c."nivel", c."step", COALESCE(c."inscritos",0)::int AS "inscritos",
           (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" b
             WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
               AND (b."asistio" = true OR b."asistencia" = true OR b."calificacion" IS NOT NULL)
           ) AS "conAsistencia"
    FROM "CALENDARIO" c
    JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
    LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
    WHERE c."cursoCampaignId" IS NOT NULL AND cc."activa" = true`;

  sql += inClause(f.guias, 'cc."guia"', params);
  sql += inClause(f.cursos, 'cc."tipoCurso"', params);
  sql += inClause(f.salones, 'cc."_id"', params);
  if (f.campaign) { params.push(f.campaign); sql += ` AND cc."campaign" = $${params.length}`; }
  if (f.fecha) {
    params.push(f.fecha);
    if (f.fechaHasta) {
      params.push(f.fechaHasta);
      sql += ` AND (c."dia" AT TIME ZONE 'America/Santiago')::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`;
    } else {
      sql += ` AND (c."dia" AT TIME ZONE 'America/Santiago')::date = $${params.length}::date`;
    }
  }
  sql += ` ORDER BY c."dia", cc."tipoCurso", cc."salon" LIMIT 500`;

  const r = await query<SesionRow>(sql, params);
  return r.rows;
}

export interface SuspensionItem { cursoCampaignId: string; fecha: string }

export interface CambioCurso {
  cursoCampaignId: string;
  curso: string;
  fechasSuspendidas: string[];
  ultimaSesionAntes: string | null;
  ultimaSesionDespues: string | null;
  sesionesAntes: number;
  sesionesDespues: number;
  alumnos: number;
  estadoReaplicado?: number;
  estadoSinMatch?: number;
  error?: string;
}

/** Última fecha de clase y nº de eventos de un curso (fin REAL del curso). */
async function resumenCurso(cursoId: string): Promise<{ ultima: string | null; total: number }> {
  const r = await query<{ ultima: string | null; total: number }>(
    `SELECT MAX((c."dia" AT TIME ZONE 'America/Santiago')::date)::text AS "ultima",
            COUNT(*)::int AS "total"
     FROM "CALENDARIO" c WHERE c."cursoCampaignId" = $1`,
    [cursoId]
  );
  return { ultima: r.rows[0]?.ultima ?? null, total: r.rows[0]?.total ?? 0 };
}

/**
 * Vista previa (sin escribir): qué pasaría al suspender esas fechas.
 * Alimenta el modal de confirmación.
 */
export async function previsualizar(items: SuspensionItem[]): Promise<CambioCurso[]> {
  const porCurso = agruparPorCurso(items);
  const out: CambioCurso[] = [];
  for (const [cursoId, fechas] of Array.from(porCurso.entries())) {
    const info = await query<any>(
      `SELECT "campaign","tipoCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoId]
    );
    const c = info.rows[0];
    const antes = await resumenCurso(cursoId);
    const alumnos = await query<{ n: number }>(
      `SELECT COUNT(DISTINCT p."_id")::int AS n FROM "PEOPLE" p
       JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       WHERE cc."_id" = $1 AND p."tipoUsuario" = 'BENEFICIARIO' AND p."aprobacion" IN ('Aprobado','Aprobada')`,
      [cursoId]
    );
    out.push({
      cursoCampaignId: cursoId,
      curso: c ? `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon || '—'}` : cursoId,
      fechasSuspendidas: fechas,
      ultimaSesionAntes: antes.ultima,
      // Se corre una sesión al final por cada fecha suspendida; la fecha exacta la
      // decide el generador (salta festivos y otras suspensiones), así que aquí se
      // reporta el conteo y el "antes". El "después" real se devuelve al aplicar.
      ultimaSesionDespues: null,
      sesionesAntes: antes.total,
      sesionesDespues: antes.total, // el total se conserva: la sesión se corre, no se pierde
      alumnos: alumnos.rows[0]?.n ?? 0,
    });
  }
  return out;
}

function agruparPorCurso(items: SuspensionItem[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const it of items) {
    const f = String(it.fecha).slice(0, 10);
    const arr = m.get(it.cursoCampaignId) || [];
    if (!arr.includes(f)) arr.push(f);
    m.set(it.cursoCampaignId, arr);
  }
  for (const arr of Array.from(m.values())) arr.sort();
  return m;
}

/**
 * Suspende las fechas indicadas y regenera cada curso afectado.
 * Devuelve el cambio real por curso (última sesión antes → después).
 */
export async function suspender(
  items: SuspensionItem[],
  motivo: string,
  actor: { email?: string | null; nombre?: string | null }
): Promise<CambioCurso[]> {
  if (!items?.length) throw new ValidationError('No hay sesiones seleccionadas');
  if (!motivo || !motivo.trim()) throw new ValidationError('El motivo es obligatorio');

  const porCurso = agruparPorCurso(items);
  const out: CambioCurso[] = [];

  for (const [cursoId, fechas] of Array.from(porCurso.entries())) {
    const info = await query<any>(
      `SELECT "campaign","tipoCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoId]
    );
    const c = info.rows[0];
    const nombre = c ? `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon || '—'}` : cursoId;
    const antes = await resumenCurso(cursoId);

    try {
      for (const f of fechas) {
        await query(
          `INSERT INTO "CURSOS_SUSPENSIONES" ("_id","cursoCampaignId","fecha","motivo","realizadoPor","realizadoPorNombre","_createdDate")
           VALUES ($1,$2,$3::date,$4,$5,$6,NOW())
           ON CONFLICT ("cursoCampaignId","fecha") DO NOTHING`,
          [ids.event(), cursoId, f, motivo.trim(), actor.email || null, actor.nombre || null]
        );
      }
      const regen = await regenerarCursoPreservandoEstado(cursoId);
      const despues = await resumenCurso(cursoId);
      out.push({
        cursoCampaignId: cursoId, curso: nombre, fechasSuspendidas: fechas,
        ultimaSesionAntes: antes.ultima, ultimaSesionDespues: despues.ultima,
        sesionesAntes: antes.total, sesionesDespues: despues.total,
        alumnos: regen.alumnos,
        estadoReaplicado: regen.estadoReaplicado,
        estadoSinMatch: regen.estadoSinMatch,
      });
    } catch (err: any) {
      out.push({
        cursoCampaignId: cursoId, curso: nombre, fechasSuspendidas: fechas,
        ultimaSesionAntes: antes.ultima, ultimaSesionDespues: null,
        sesionesAntes: antes.total, sesionesDespues: antes.total, alumnos: 0,
        error: err?.message || String(err),
      });
    }
  }
  return out;
}

/** Revierte una suspensión: la fecha vuelve a dictarse y el curso se regenera. */
export async function reactivar(cursoCampaignId: string, fecha: string): Promise<CambioCurso> {
  const info = await query<any>(
    `SELECT "campaign","tipoCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoCampaignId]
  );
  const c = info.rows[0];
  const antes = await resumenCurso(cursoCampaignId);
  await query(
    `DELETE FROM "CURSOS_SUSPENSIONES" WHERE "cursoCampaignId" = $1 AND "fecha" = $2::date`,
    [cursoCampaignId, String(fecha).slice(0, 10)]
  );
  const regen = await regenerarCursoPreservandoEstado(cursoCampaignId);
  const despues = await resumenCurso(cursoCampaignId);
  return {
    cursoCampaignId,
    curso: c ? `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon || '—'}` : cursoCampaignId,
    fechasSuspendidas: [String(fecha).slice(0, 10)],
    ultimaSesionAntes: antes.ultima, ultimaSesionDespues: despues.ultima,
    sesionesAntes: antes.total, sesionesDespues: despues.total,
    alumnos: regen.alumnos,
    estadoReaplicado: regen.estadoReaplicado,
    estadoSinMatch: regen.estadoSinMatch,
  };
}

export interface SuspensionRegistrada {
  _id: string;
  cursoCampaignId: string;
  curso: string;
  fecha: string;
  motivo: string;
  realizadoPorNombre: string | null;
  realizadoPor: string | null;
  _createdDate: string;
}

/** Suspensiones ya registradas (para la tabla inferior de la página). */
export async function listarSuspensiones(campaign?: string | null): Promise<SuspensionRegistrada[]> {
  const params: any[] = [];
  let sql = `
    SELECT s."_id", s."cursoCampaignId", s."fecha"::text AS "fecha", s."motivo",
           s."realizadoPor", s."realizadoPorNombre", s."_createdDate"::text AS "_createdDate",
           (cc."campaign" || ' · ' || cc."tipoCurso" || ' · Salón ' || COALESCE(cc."salon",'—')) AS "curso"
    FROM "CURSOS_SUSPENSIONES" s
    JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = s."cursoCampaignId"`;
  if (campaign) { params.push(campaign); sql += ` WHERE cc."campaign" = $${params.length}`; }
  sql += ` ORDER BY s."fecha" DESC, cc."tipoCurso" LIMIT 500`;
  const r = await query<SuspensionRegistrada>(sql, params);
  return r.rows;
}
