/**
 * Evaluations Repository — SQL para ACADEMICA_BOOKING_EVALUATIONS.
 *
 * Tabla append-only: NO hay update() ni delete(). Una evaluación se crea
 * UNA sola vez (UNIQUE en bookingId garantiza unicidad). El service valida
 * elegibilidad antes de insertar.
 *
 * V2 (mayo 2026):
 *   - 4 dimensiones (puntualidad, claridad, actividades, ambiente) en vez de 6.
 *   - findEligibleByStudent agrega ventana semanal: solo bookings de la SEMANA
 *     ACTUAL del estudiante (lunes 00:00 → domingo 23:59 en la TZ del server).
 *     Las sesiones de semanas pasadas sin evaluar expiran solas.
 *   - listForDashboard acepta búsqueda por substring en comentarios.
 */
import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';

const JSONB_FIELDS = ['aiCategorias'];

class EvaluationsRepositoryClass extends BaseRepository {
  constructor() { super('ACADEMICA_BOOKING_EVALUATIONS', JSONB_FIELDS); }

  /** ¿Ya hay evaluación para este booking? */
  async findByBookingId(bookingId: string) {
    return queryOne<any>(
      `SELECT * FROM "ACADEMICA_BOOKING_EVALUATIONS" WHERE "bookingId" = $1`,
      [bookingId]
    );
  }

  /**
   * Bookings ASISTIDOS por el estudiante en la SEMANA ACTUAL (lunes-domingo)
   * que ya pasaron y aún NO tienen evaluación.
   * Excluye: cancelados, no-show, WELCOME, COMPLEMENTARIA.
   * Usa CALENDARIO JOIN para tomar tipo/nivel/step reales del evento.
   *
   * Ventana semanal: PostgreSQL `date_trunc('week', NOW())` arranca en LUNES
   * (ISO 8601). Tomamos [lunes 00:00, lunes próxima semana 00:00). Lo que cae
   * fuera de esa ventana se considera expirado para evaluación.
   */
  async findEligibleByStudent(academicaId: string) {
    return queryMany<any>(
      `SELECT
         b."_id"                                      AS "bookingId",
         b."studentId",
         b."advisor"                                  AS "advisorId",
         COALESCE(b."eventoId", b."idEvento")         AS "eventoId",
         COALESCE(c."tipo", b."tipoEvento", b."tipo") AS "tipo",
         COALESCE(c."step", b."step")                 AS "step",
         COALESCE(c."nivel", b."nivel")               AS "nivel",
         b."nombreEvento",
         b."plataforma",
         COALESCE(c."dia", b."fechaEvento")           AS "fechaEvento",
         adv."nombreCompleto"                         AS "advisorNombre"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c
         ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "ADVISORS" adv
         ON adv."_id" = b."advisor" OR LOWER(adv."email") = LOWER(b."advisor")
       WHERE (b."studentId" = $1 OR b."idEstudiante" = $1)
         AND (b."asistio" = true OR b."asistencia" = true)
         AND (b."cancelo" IS NULL OR b."cancelo" = false)
         AND COALESCE(c."nivel", b."nivel", '') NOT IN ('WELCOME', '')
         AND COALESCE(c."tipo", b."tipoEvento", b."tipo", '') IN ('SESSION', 'CLUB')
         AND COALESCE(c."dia", b."fechaEvento") IS NOT NULL
         AND COALESCE(c."dia", b."fechaEvento") <= NOW()
         AND COALESCE(c."dia", b."fechaEvento") >= date_trunc('week', NOW())
         AND COALESCE(c."dia", b."fechaEvento") <  date_trunc('week', NOW()) + INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM "ACADEMICA_BOOKING_EVALUATIONS" e WHERE e."bookingId" = b."_id"
         )
       ORDER BY COALESCE(c."dia", b."fechaEvento") DESC`,
      [academicaId]
    );
  }

  /** INSERT — única operación de escritura. UNIQUE constraint da defensa final. */
  async insertOne(input: {
    _id: string; bookingId: string; studentId: string;
    advisorId: string | null; eventoId: string | null;
    tipo: string | null; subtipo: string | null;
    nivel: string | null; step: string | null;
    plataforma: string | null;
    fechaEvento: string | null;
    puntualidad: number; claridad: number; actividades: number; ambiente: number;
    promedio: number;
    comentario: string | null;
    ipAddress: string | null; userAgent: string | null;
  }) {
    return queryOne<any>(
      `INSERT INTO "ACADEMICA_BOOKING_EVALUATIONS" (
        "_id","bookingId","studentId","advisorId","eventoId",
        "tipo","subtipo","nivel","step","plataforma","fechaEvento",
        "puntualidad","claridad","actividades","ambiente",
        "promedio","comentario","ipAddress","userAgent","_createdDate"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW()
      ) RETURNING *`,
      [
        input._id, input.bookingId, input.studentId, input.advisorId, input.eventoId,
        input.tipo, input.subtipo, input.nivel, input.step, input.plataforma, input.fechaEvento,
        input.puntualidad, input.claridad, input.actividades, input.ambiente,
        input.promedio, input.comentario, input.ipAddress, input.userAgent,
      ]
    );
  }

  /**
   * Lectura para el dashboard admin: filtros + búsqueda en comentarios.
   * Devuelve filas planas; el service agrega KPIs/ranking/charts.
   */
  async listForDashboard(opts: {
    startDate?: string | null;
    endDate?: string | null;
    advisorId?: string | null;
    nivel?: string | null;
    tipo?: string | null;
    plataforma?: string | null;
    comentarioSearch?: string | null;
  }) {
    const conds: string[] = ['1=1'];
    const params: any[] = [];
    let i = 1;
    if (opts.startDate) { conds.push(`"fechaEvento" >= $${i}::date`);    params.push(opts.startDate); i++; }
    if (opts.endDate)   { conds.push(`"fechaEvento" <= $${i}::date`);    params.push(opts.endDate);   i++; }
    if (opts.advisorId) { conds.push(`"advisorId" = $${i}`);             params.push(opts.advisorId); i++; }
    if (opts.nivel)     { conds.push(`"nivel" = $${i}`);                  params.push(opts.nivel);     i++; }
    if (opts.tipo)      { conds.push(`"tipo" = $${i}`);                   params.push(opts.tipo);      i++; }
    if (opts.plataforma){ conds.push(`"plataforma" = $${i}`);             params.push(opts.plataforma); i++; }
    if (opts.comentarioSearch && opts.comentarioSearch.trim()) {
      conds.push(`"comentario" ILIKE $${i}`);
      params.push(`%${opts.comentarioSearch.trim()}%`);
      i++;
    }

    return queryMany<any>(
      `SELECT * FROM "ACADEMICA_BOOKING_EVALUATIONS"
       WHERE ${conds.join(' AND ')}
       ORDER BY "_createdDate" DESC
       LIMIT 5000`,
      params
    );
  }
}

export const EvaluationsRepository = new EvaluationsRepositoryClass();
