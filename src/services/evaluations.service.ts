/**
 * Evaluations Service — lógica de negocio para Performance Evaluation.
 *
 *   - Feature flag global en APP_CONFIG (performance_eval_mode = off/beta/on).
 *   - Whitelist de beta-testers por email (performance_eval_beta_users).
 *   - Submit: valida elegibilidad, calcula promedio /4, INSERT con snapshot.
 *   - getDashboardStats: KPIs + Top/Bottom ranking + métricas por dimensión +
 *     distribución por dimensión + búsqueda en comentarios + evolución mensual.
 *
 * V2 (mayo 2026):
 *   - 4 dims (puntualidad, claridad, actividades, ambiente) en vez de 6.
 *   - Ventana semanal lunes-domingo aplicada en findEvaluablesForStudent.
 *   - Filtro de groserías: blacklist local + OpenAI Moderation (no bloqueante
 *     si OpenAI falla — local manda como red de seguridad).
 *
 * Lectura del flag tiene caché en proceso de 30s para evitar query por request.
 */
import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { EvaluationsRepository } from '@/repositories/evaluations.repository';
import { ValidationError, ForbiddenError, ConflictError, NotFoundError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { checkProfanity, PROFANITY_MESSAGE } from '@/lib/profanity-filter';
import { moderateText } from '@/lib/openai-moderation';

export type FeatureMode = 'off' | 'beta' | 'on';

interface FlagState { mode: FeatureMode; betaUsers: string[]; loadedAt: number }
let flagCache: FlagState | null = null;
const FLAG_TTL_MS = 30 * 1000;

const COMMENT_MAX = 250;
const DIMS = ['puntualidad', 'claridad', 'actividades', 'ambiente'] as const;
type Dim = typeof DIMS[number];

async function loadFlag(): Promise<FlagState> {
  if (flagCache && Date.now() - flagCache.loadedAt < FLAG_TTL_MS) return flagCache;
  const rows = await query<{ key: string; value: string }>(
    `SELECT "key","value" FROM "APP_CONFIG"
     WHERE "key" IN ('performance_eval_mode','performance_eval_beta_users')`
  );
  let mode: FeatureMode = 'off';
  let betaUsers: string[] = [];
  for (const r of rows.rows) {
    if (r.key === 'performance_eval_mode') {
      const v = (r.value || '').toLowerCase();
      mode = (v === 'on' || v === 'beta') ? v : 'off';
    } else if (r.key === 'performance_eval_beta_users') {
      try { const arr = JSON.parse(r.value || '[]'); if (Array.isArray(arr)) betaUsers = arr.map(e => String(e).toLowerCase()); }
      catch { betaUsers = []; }
    }
  }
  flagCache = { mode, betaUsers, loadedAt: Date.now() };
  return flagCache;
}

export function invalidateFlagCache() { flagCache = null; }

export async function getFeatureFlag() {
  const f = await loadFlag();
  return { mode: f.mode, betaUsers: f.betaUsers };
}

export async function updateFeatureFlag(input: { mode: FeatureMode; betaUsers: string[] }) {
  if (!['off','beta','on'].includes(input.mode)) throw new ValidationError('mode inválido');
  if (!Array.isArray(input.betaUsers)) throw new ValidationError('betaUsers debe ser array');
  const normalized = Array.from(new Set(
    input.betaUsers.map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  ));
  await query(
    `INSERT INTO "APP_CONFIG"("key","value") VALUES ('performance_eval_mode', $1)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "_updatedDate" = NOW()`,
    [input.mode]
  );
  await query(
    `INSERT INTO "APP_CONFIG"("key","value") VALUES ('performance_eval_beta_users', $1)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "_updatedDate" = NOW()`,
    [JSON.stringify(normalized)]
  );
  invalidateFlagCache();
  return { mode: input.mode, betaUsers: normalized };
}

/** ¿El feature está activo PARA este email? Define visibilidad de la UI. */
export async function isEnabledForEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const f = await loadFlag();
  if (f.mode === 'off') return false;
  if (f.mode === 'on')  return true;
  // beta:
  return f.betaUsers.includes(String(email).toLowerCase());
}

/** Bookings ASISTIDOS sin evaluar de la semana actual — entrada para tarjeta "Sin Evaluar". */
export async function findEvaluablesForStudent(academicaId: string) {
  return EvaluationsRepository.findEligibleByStudent(academicaId);
}

/**
 * Guarda una evaluación. Valida todo del lado servidor:
 *   - feature flag activo para el email
 *   - booking existe y pertenece al estudiante
 *   - asistencia OK, no cancelado, tipo evaluable, nivel != WELCOME
 *   - no hay eval previa para ese booking
 *   - 4 ratings en [1..5]
 *   - comentario <= 250 chars
 *   - comentario NO contiene groserías (blacklist local + OpenAI Moderation)
 *
 * Devuelve la fila creada.
 */
export async function submitEvaluation(input: {
  email: string | null;
  academicaId: string;
  bookingId: string;
  puntualidad: number; claridad: number; actividades: number; ambiente: number;
  comentario?: string | null;
  ip?: string | null; userAgent?: string | null;
}) {
  // 1) Feature flag
  const enabled = await isEnabledForEmail(input.email);
  if (!enabled) throw new ForbiddenError('Performance Evaluation no está habilitado para tu cuenta.');

  // 2) Ratings 1..5
  for (const k of DIMS) {
    const v = (input as any)[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new ValidationError(`${k} debe ser entero entre 1 y 5`);
  }
  const comentario = (input.comentario || '').trim();
  if (comentario.length > COMMENT_MAX) {
    throw new ValidationError(`Comentario no puede exceder ${COMMENT_MAX} caracteres`);
  }

  // 3) Filtro de groserías (defensa en profundidad — el cliente también valida).
  if (comentario) {
    const local = checkProfanity(comentario);
    if (local.blocked) {
      throw new ValidationError(PROFANITY_MESSAGE);
    }
    // OpenAI Moderation como segunda barrera. Si falla / timeout no bloquea —
    // confiamos en el blacklist local. Si responde y marca → bloqueamos.
    const remote = await moderateText(comentario);
    if (remote.flagged) {
      throw new ValidationError(PROFANITY_MESSAGE);
    }
  }

  // 4) Booking existe + pertenece al estudiante + elegible
  const booking = await queryOne<any>(
    `SELECT b.*,
            COALESCE(c."tipo", b."tipoEvento", b."tipo") AS "tipo_real",
            COALESCE(c."nivel", b."nivel")               AS "nivel_real",
            COALESCE(c."step", b."step")                 AS "step_real",
            COALESCE(c."dia", b."fechaEvento")           AS "fecha_real"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
     WHERE b."_id" = $1`,
    [input.bookingId]
  );
  if (!booking) throw new NotFoundError('Booking', input.bookingId);
  const pertenece = booking.studentId === input.academicaId || booking.idEstudiante === input.academicaId;
  if (!pertenece) throw new ForbiddenError('El booking no pertenece al estudiante autenticado');

  // 5) Reglas de elegibilidad
  const asistio = booking.asistio === true || booking.asistencia === true;
  if (!asistio) throw new ValidationError('Solo se pueden evaluar sesiones con asistencia registrada');
  if (booking.cancelo === true) throw new ValidationError('No se pueden evaluar sesiones canceladas');
  if (booking.nivel_real === 'WELCOME') throw new ValidationError('Las sesiones WELCOME no son evaluables');
  const tipo = String(booking.tipo_real || '').toUpperCase();
  if (!['SESSION','CLUB'].includes(tipo)) {
    throw new ValidationError(`Tipo de evento no evaluable: ${tipo || '(sin tipo)'}`);
  }
  if (!booking.fecha_real || new Date(booking.fecha_real) > new Date()) {
    throw new ValidationError('La sesión aún no ha ocurrido — debe haber pasado para poder evaluar');
  }

  // 6) No evaluado previamente
  const ya = await EvaluationsRepository.findByBookingId(input.bookingId);
  if (ya) throw new ConflictError('Esta sesión ya fue evaluada anteriormente');

  // 7) Derivar subtipo (TRAINING/JUMP)
  const stepStr = String(booking.step_real || '');
  const stepNum = parseInt((stepStr.match(/(\d+)/) || [])[1] || '0', 10);
  let subtipo: string | null = null;
  if (tipo === 'CLUB' && /^TRAINING\s*-/i.test(stepStr)) subtipo = 'TRAINING';
  else if (tipo === 'SESSION' && stepNum > 0 && stepNum % 5 === 0) subtipo = 'JUMP';

  // 8) Promedio /4
  const promedio = (
    (input.puntualidad + input.claridad + input.actividades + input.ambiente) / 4
  );

  // 9) INSERT (snapshot inmutable)
  const created = await EvaluationsRepository.insertOne({
    _id: ids.audit(),
    bookingId: input.bookingId,
    studentId: input.academicaId,
    advisorId: booking.advisor || null,
    eventoId: booking.eventoId || booking.idEvento || null,
    tipo,
    subtipo,
    nivel: booking.nivel_real || null,
    step:  booking.step_real || null,
    plataforma: booking.plataforma || null,
    fechaEvento: booking.fecha_real || null,
    puntualidad: input.puntualidad,
    claridad: input.claridad,
    actividades: input.actividades,
    ambiente: input.ambiente,
    promedio: Math.round(promedio * 100) / 100,
    comentario: comentario || null,
    ipAddress: input.ip || null,
    userAgent: input.userAgent || null,
  });
  return created;
}

/**
 * Estadísticas para el dashboard admin.
 * Devuelve KPIs + ranking Top 5 / Bottom 5 (mín 5 evals) + métricas por
 * dimensión + distribución por dimensión + evolución mensual + comentarios.
 */
export async function getDashboardStats(opts: {
  startDate?: string | null;
  endDate?: string | null;
  advisorId?: string | null;
  nivel?: string | null;
  tipo?: string | null;
  plataforma?: string | null;
  comentarioSearch?: string | null;
}) {
  const rows = await EvaluationsRepository.listForDashboard(opts);

  // === KPIs globales ===
  const total = rows.length;
  const promedioGeneral = total > 0
    ? Math.round((rows.reduce((s, r) => s + Number(r.promedio), 0) / total) * 100) / 100
    : 0;
  const satisfaccionPct = total > 0
    ? Math.round((rows.filter(r => Number(r.promedio) >= 4).length / total) * 100)
    : 0;
  const totalComentarios = rows.filter(r => r.comentario && String(r.comentario).trim().length > 0).length;
  const largoPromedioComentario = totalComentarios > 0
    ? Math.round(
        rows.filter(r => r.comentario)
            .reduce((s, r) => s + String(r.comentario).trim().length, 0) / totalComentarios
      )
    : 0;
  const pctConComentario = total > 0 ? Math.round((totalComentarios / total) * 100) : 0;

  // === Métricas por DIMENSIÓN (las 4) ===
  // Para cada dim: promedio global + % satisfacción + distribución 1→5.
  const porDimension = DIMS.map(dim => {
    const valores = rows.map(r => Number(r[dim] || 0)).filter(v => v > 0);
    if (valores.length === 0) {
      return { dim, promedio: 0, satisfaccionPct: 0, distribucion: [1,2,3,4,5].map(e => ({ estrella: e, total: 0 })) };
    }
    const prom = Math.round((valores.reduce((s, v) => s + v, 0) / valores.length) * 100) / 100;
    const satPct = Math.round((valores.filter(v => v >= 4).length / valores.length) * 100);
    const distribucion = [1,2,3,4,5].map(estrella => ({
      estrella, total: valores.filter(v => v === estrella).length,
    }));
    return { dim, promedio: prom, satisfaccionPct: satPct, distribucion };
  });

  // === Ranking por advisor (con nombre + dimensiones para radar) ===
  const byAdvisor = new Map<string, {
    advisorId: string; count: number; sum: number;
    sumByDim: Record<string, number>;
  }>();
  for (const r of rows) {
    const k = r.advisorId || '__sin_advisor__';
    const cur = byAdvisor.get(k) ?? {
      advisorId: k, count: 0, sum: 0,
      sumByDim: { puntualidad: 0, claridad: 0, actividades: 0, ambiente: 0 } as Record<string, number>,
    };
    cur.count++;
    cur.sum += Number(r.promedio);
    for (const dim of DIMS) cur.sumByDim[dim] += Number(r[dim] || 0);
    byAdvisor.set(k, cur);
  }
  const advisorIds = Array.from(byAdvisor.keys()).filter(k => k !== '__sin_advisor__');
  const advisorNames = new Map<string, string>();
  if (advisorIds.length) {
    const advs = await query<{ _id: string; nombreCompleto: string }>(
      `SELECT "_id","nombreCompleto" FROM "ADVISORS" WHERE "_id" = ANY($1::text[])`,
      [advisorIds]
    );
    for (const a of advs.rows) advisorNames.set(a._id, a.nombreCompleto);
  }
  const rankingFull = Array.from(byAdvisor.values()).map(a => ({
    advisorId: a.advisorId,
    nombre: advisorNames.get(a.advisorId) || (a.advisorId === '__sin_advisor__' ? '(sin advisor)' : a.advisorId),
    evaluaciones: a.count,
    promedio: Math.round((a.sum / a.count) * 100) / 100,
    dimensiones: Object.fromEntries(
      Object.entries(a.sumByDim).map(([k, v]) => [k, Math.round((v / a.count) * 100) / 100])
    ),
  }));
  // Sólo advisors con >=5 evals entran al ranking público
  const elegibles = rankingFull.filter(a => a.evaluaciones >= 5);
  const top5    = [...elegibles].sort((a, b) => b.promedio - a.promedio).slice(0, 5);
  const bottom5 = [...elegibles].sort((a, b) => a.promedio - b.promedio).slice(0, 5);
  const conMasEvals = [...rankingFull].sort((a, b) => b.evaluaciones - a.evaluaciones)[0] ?? null;

  // === Distribución global del promedio (redondeado a entero) ===
  const distribucion = [1,2,3,4,5].map(estrella => ({
    estrella,
    total: rows.filter(r => Math.round(Number(r.promedio)) === estrella).length,
  }));

  // === Evolución mensual (promedio por mes) ===
  const byMes = new Map<string, { count: number; sum: number }>();
  for (const r of rows) {
    if (!r.fechaEvento) continue;
    const d = new Date(r.fechaEvento);
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const cur = byMes.get(k) ?? { count: 0, sum: 0 };
    cur.count++; cur.sum += Number(r.promedio);
    byMes.set(k, cur);
  }
  const evolucionMensual = Array.from(byMes.entries())
    .map(([mes, v]) => ({ mes, promedio: Math.round((v.sum / v.count) * 100) / 100, evaluaciones: v.count }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  // === Comentarios (lista — el front aplica anonimización por rol) ===
  const comentarios = rows
    .filter(r => r.comentario && String(r.comentario).trim().length > 0)
    .slice(0, 200)
    .map(r => ({
      _id: r._id,
      fechaEvento: r.fechaEvento,
      advisorId: r.advisorId,
      advisorNombre: r.advisorId ? (advisorNames.get(r.advisorId) || '') : '',
      nivel: r.nivel, tipo: r.tipo, subtipo: r.subtipo,
      promedio: Number(r.promedio),
      comentario: r.comentario,
      aiSentimiento: r.aiSentimiento ?? null,
    }));

  return {
    kpis: {
      totalEvaluaciones: total,
      promedioGeneral,
      satisfaccionPct,
      advisorConMasEvals: conMasEvals,
      advisorsEnRanking: elegibles.length,
      advisorsConPocas: rankingFull.length - elegibles.length,
      totalComentarios,
      pctConComentario,
      largoPromedioComentario,
    },
    porDimension,
    rankingTop5: top5,
    rankingBottom5: bottom5,
    rankingFull,
    distribucion,
    evolucionMensual,
    comentarios,
    rangoFiltro: { startDate: opts.startDate ?? null, endDate: opts.endDate ?? null },
  };
}
