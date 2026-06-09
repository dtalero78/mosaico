/**
 * Usuarios Pegados — detección y reconciliación masiva
 *
 * Detecta estudiantes activos cuyo `ACADEMICA.step` está por debajo del
 * step real calculado según sus bookings, y permite reconciliar en bulk
 * con auditoría.
 *
 * Aplica la misma lógica que `isCurrentStepComplete()` en student.service.ts
 * y que `getEffectiveStepNumber()` en student-booking.service.ts, replicada
 * aquí para poder ejecutarse en memoria sobre miles de estudiantes en un
 * solo barrido (vs 1 query por estudiante).
 *
 * Reglas:
 *   - STEP_OVERRIDES tiene prioridad absoluta (isCompleted=true/false)
 *   - Jump (Step %5==0): algún booking con asistio+participacion+!noAprobo+!cancelo
 *   - Normal: ≥2 SESSION exitosas (COMPLEMENTARIA cuenta) + ≥1 TRAINING + sin noAprobo
 *   - Cancelados NO cuentan
 *
 * Niveles excluidos: WELCOME, ESS, DONE, MASTER, IELTS, IELS, B2FIRST, TOEFL
 *   (cada uno tiene su propio flujo de promoción).
 */

import 'server-only';
import { query, queryMany, queryOne } from '@/lib/postgres';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { PeopleRepository } from '@/repositories/people.repository';
import { changeStep } from '@/services/student.service';
import { ValidationError } from '@/lib/errors';

const NIVELES_ORDEN = [
  { code: 'BN1', steps: [1, 2, 3, 4, 5] },
  { code: 'BN2', steps: [6, 7, 8, 9, 10] },
  { code: 'BN3', steps: [11, 12, 13, 14, 15] },
  { code: 'P1',  steps: [16, 17, 18, 19, 20] },
  { code: 'P2',  steps: [21, 22, 23, 24, 25] },
  { code: 'P3',  steps: [26, 27, 28, 29, 30] },
  { code: 'F1',  steps: [31, 32, 33, 34, 35] },
  { code: 'F2',  steps: [36, 37, 38, 39, 40] },
  { code: 'F3',  steps: [41, 42, 43, 44, 45] },
] as const;

const NIVELES_CODES = NIVELES_ORDEN.map(n => n.code);
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_BULK_SIZE = 100;
const CONCURRENCY = 5;

// ────────────────────────────── tipos ──────────────────────────────

export interface PegadoRow {
  academicaId: string;
  numeroId: string;
  nombre: string;
  contrato: string | null;
  plataforma: string | null;
  nivel: string;
  stepActual: number;
  stepReal: number;
  desfase: number;
  totalBookings: number;
  clrHistoric: boolean;
  overridesCount: number;
  overrideDetails: Array<{ step: string; isCompleted: boolean }>;
}

export interface PegadosResult {
  calculatedAt: string;
  rows: PegadoRow[];
  total: number;
  cached: boolean;
}

export interface ReconciliarItemResult {
  academicaId: string;
  status: 'ok' | 'already_synced' | 'blocked_by_override' | 'no_change_needed' | 'error';
  from?: { nivel: string; step: string };
  to?:   { nivel: string; step: string };
  error?: string;
}

interface BookingRow {
  sid: string;
  step: string | null;
  tipo: string | null;
  nombreEvento: string | null;
  asistio: boolean | null;
  asistencia: boolean | null;
  participacion: boolean | null;
  noAprobo: boolean | null;
  cancelo: boolean | null;
}

// ──────────────────────── helpers (puro) ────────────────────────

function extractStepNum(stepName: string | null | undefined): number | null {
  if (!stepName) return null;
  const m = String(stepName).match(/Step\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function isExitosa(b: BookingRow): boolean {
  return b.asistio === true || b.asistencia === true;
}

function aproboElJump(b: BookingRow): boolean {
  return isExitosa(b) && b.participacion === true && b.noAprobo !== true && b.cancelo !== true;
}

function getClassType(b: BookingRow): 'SESSION' | 'CLUB' | 'OTHER' {
  if (b.tipo === 'SESSION' || b.tipo === 'COMPLEMENTARIA') return 'SESSION';
  if (b.tipo === 'CLUB') return 'CLUB';
  if (!b.tipo && b.step) {
    if (/^TRAINING\s*-/i.test(b.step)) return 'CLUB';
    if (/^Step\s+\d+$/i.test(b.step)) return 'SESSION';
  }
  return 'OTHER';
}

function isStepComplete(
  stepNum: number,
  bookings: BookingRow[],
  overrides: Map<string, boolean>,
): boolean {
  const ov = overrides.get(`Step ${stepNum}`);
  if (ov !== undefined) return ov === true;

  const clasesDelStep = bookings.filter(b => {
    if (b.cancelo === true) return false;
    return extractStepNum(b.step) === stepNum;
  });
  if (clasesDelStep.length === 0) return false;

  const esJump = stepNum > 0 && stepNum % 5 === 0;
  if (esJump) return clasesDelStep.some(b => aproboElJump(b));

  if (clasesDelStep.some(b => b.noAprobo === true)) return false;

  const sesionesExitosas = clasesDelStep.filter(b => getClassType(b) === 'SESSION' && isExitosa(b)).length;
  const trainingClubsExitosos = clasesDelStep.filter(b => {
    if (getClassType(b) !== 'CLUB') return false;
    const name = b.step || b.nombreEvento || '';
    return /^TRAINING\s*-/i.test(name) && isExitosa(b);
  }).length;
  return sesionesExitosas >= 2 && trainingClubsExitosos >= 1;
}

/**
 * Devuelve el step real del estudiante en su nivel actual:
 * primer step incompleto en orden, o el primer step del siguiente nivel
 * si todos los del nivel actual están completos.
 */
function computeStepReal(
  nivelActual: string,
  bookings: BookingRow[],
  overrides: Map<string, boolean>,
): number | null {
  const nivelInfo = NIVELES_ORDEN.find(n => n.code === nivelActual);
  if (!nivelInfo) return null;

  for (const stepNum of nivelInfo.steps) {
    if (!isStepComplete(stepNum, bookings, overrides)) return stepNum;
  }
  const idx = NIVELES_ORDEN.findIndex(n => n.code === nivelActual);
  const next = NIVELES_ORDEN[idx + 1];
  return next ? next.steps[0] : nivelInfo.steps[nivelInfo.steps.length - 1] + 1;
}

// ──────────────────────── caché ────────────────────────

let cache: PegadosResult | null = null;
let cacheTimestamp = 0;

function isCacheValid(): boolean {
  return cache !== null && (Date.now() - cacheTimestamp) < CACHE_TTL_MS;
}

export function invalidateCache(): void {
  cache = null;
  cacheTimestamp = 0;
}

// ──────────────────────── API pública ────────────────────────

/**
 * Calcula el listado completo de estudiantes pegados.
 * Cachea el resultado por 30 min. Llamar con `force: true` para recalcular.
 */
export async function findPegados(opts?: { force?: boolean }): Promise<PegadosResult> {
  if (!opts?.force && isCacheValid()) {
    return { ...cache!, cached: true };
  }

  const students = await queryMany<{
    academicaId: string;
    numeroId: string;
    primerNombre: string | null;
    primerApellido: string | null;
    segundoApellido: string | null;
    nivel: string;
    step: string;
    plataforma: string | null;
    contrato: string | null;
    chkclrhistoric: number | null;
  }>(
    `SELECT a."_id"             AS "academicaId",
            a."numeroId",
            a."primerNombre",
            a."primerApellido",
            a."segundoApellido",
            a."nivel",
            a."step",
            a."plataforma",
            p."contrato",
            a."chkclrhistoric"
     FROM "ACADEMICA" a
     LEFT JOIN LATERAL (
       SELECT p2."contrato"
       FROM "PEOPLE" p2
       WHERE p2."numeroId" = a."numeroId"
       ORDER BY CASE WHEN p2."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
       LIMIT 1
     ) p ON true
     WHERE a."nivel" = ANY($1::text[])
       AND (a."estadoInactivo" IS NULL OR a."estadoInactivo" = false)
       AND a."step" IS NOT NULL
       AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    [NIVELES_CODES],
  );

  const academicaIds = students.map(s => s.academicaId);
  if (academicaIds.length === 0) {
    const empty: PegadosResult = { calculatedAt: new Date().toISOString(), rows: [], total: 0, cached: false };
    cache = empty; cacheTimestamp = Date.now();
    return empty;
  }

  const bookingsRows = await queryMany<BookingRow>(
    `SELECT COALESCE(b."studentId", b."idEstudiante") AS sid,
            COALESCE(c."step",  b."step")             AS step,
            COALESCE(c."tipo",  b."tipoEvento")       AS tipo,
            b."nombreEvento",
            b."asistio",
            b."asistencia",
            b."participacion",
            b."noAprobo",
            b."cancelo"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE COALESCE(b."studentId", b."idEstudiante") = ANY($1::text[])`,
    [academicaIds],
  );

  const bookingsBySid = new Map<string, BookingRow[]>();
  for (const b of bookingsRows) {
    const arr = bookingsBySid.get(b.sid) ?? [];
    arr.push(b);
    bookingsBySid.set(b.sid, arr);
  }

  // isCompleted IS NOT NULL excluye los overrides soft-deleted (que conservan
  // la fila e historial pero ya no están activos como decisión).
  const overridesRows = await queryMany<{ studentId: string; step: string; isCompleted: boolean }>(
    `SELECT "studentId", "step", "isCompleted"
     FROM "STEP_OVERRIDES"
     WHERE "studentId" = ANY($1::text[]) AND "isCompleted" IS NOT NULL`,
    [academicaIds],
  );

  const overridesBySid = new Map<string, Map<string, boolean>>();
  const overrideDetailsBySid = new Map<string, Array<{ step: string; isCompleted: boolean }>>();
  for (const o of overridesRows) {
    const m = overridesBySid.get(o.studentId) ?? new Map<string, boolean>();
    m.set(o.step, o.isCompleted);
    overridesBySid.set(o.studentId, m);

    const arr = overrideDetailsBySid.get(o.studentId) ?? [];
    arr.push({ step: o.step, isCompleted: o.isCompleted });
    overrideDetailsBySid.set(o.studentId, arr);
  }

  const rows: PegadoRow[] = [];
  for (const s of students) {
    const stepActual = extractStepNum(s.step);
    if (stepActual === null) continue;

    const bookings = bookingsBySid.get(s.academicaId) ?? [];
    if (bookings.length === 0) continue;

    const overrides = overridesBySid.get(s.academicaId) ?? new Map<string, boolean>();
    const stepReal = computeStepReal(s.nivel, bookings, overrides);
    if (stepReal === null) continue;

    if (stepReal <= stepActual) continue;

    rows.push({
      academicaId:     s.academicaId,
      numeroId:        s.numeroId,
      nombre:          `${s.primerNombre || ''} ${s.primerApellido || ''} ${s.segundoApellido || ''}`.trim().replace(/\s+/g, ' '),
      contrato:        s.contrato,
      plataforma:      s.plataforma,
      nivel:           s.nivel,
      stepActual,
      stepReal,
      desfase:         stepReal - stepActual,
      totalBookings:   bookings.length,
      clrHistoric:     (s.chkclrhistoric ?? 0) >= 1,
      overridesCount:  overridesBySid.get(s.academicaId)?.size ?? 0,
      overrideDetails: overrideDetailsBySid.get(s.academicaId) ?? [],
    });
  }

  rows.sort((a, b) => b.desfase - a.desfase || a.nivel.localeCompare(b.nivel));

  const result: PegadosResult = {
    calculatedAt: new Date().toISOString(),
    rows,
    total: rows.length,
    cached: false,
  };
  cache = result; cacheTimestamp = Date.now();
  return result;
}

/**
 * Reconcilia un conjunto de estudiantes pegados moviendo cada uno a su
 * stepReal calculado. Procesa en grupos paralelos de tamaño CONCURRENCY
 * para no agotar el pool de PostgreSQL.
 *
 * Por cada estudiante:
 *   1. Recalcula stepReal server-side (snapshot del cliente puede estar viejo)
 *   2. Si stepReal <= stepActual → skip (already_synced)
 *   3. Llama changeStep(academicaId, "Step N") — sincroniza ACADEMICA + PEOPLE
 *   4. Escribe entrada en ACADEMICA.cambioStepHistory
 *   5. Agrega comentario a PEOPLE.comentarios (Académico → General)
 */
export async function aplicarReconciliacion(opts: {
  academicaIds: string[];
  motivo: string;
  realizadoPor: string;
  realizadoPorNombre?: string;
}): Promise<ReconciliarItemResult[]> {
  if (!opts.academicaIds.length) throw new ValidationError('academicaIds es requerido');
  if (opts.academicaIds.length > MAX_BULK_SIZE) {
    throw new ValidationError(`Máximo ${MAX_BULK_SIZE} estudiantes por operación`);
  }
  if (!opts.motivo?.trim()) throw new ValidationError('El motivo es requerido');

  const realizadoPor = opts.realizadoPorNombre || opts.realizadoPor;
  const motivo = opts.motivo.trim();
  const results: ReconciliarItemResult[] = [];

  for (let i = 0; i < opts.academicaIds.length; i += CONCURRENCY) {
    const batch = opts.academicaIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(id => reconcileOne(id, motivo, realizadoPor)),
    );
    results.push(...batchResults);
  }

  invalidateCache();
  return results;
}

async function reconcileOne(
  academicaId: string,
  motivo: string,
  realizadoPor: string,
): Promise<ReconciliarItemResult> {
  try {
    const academic = await AcademicaRepository.findByAnyId(academicaId);
    if (!academic) return { academicaId, status: 'error', error: 'Estudiante no encontrado' };

    const nivelActual = academic.nivel;
    const stepActualName = academic.step;
    const stepActual = extractStepNum(stepActualName);
    if (!nivelActual || stepActual === null) {
      return { academicaId, status: 'error', error: 'Nivel/step inválido' };
    }

    const bookings = await queryMany<BookingRow>(
      `SELECT COALESCE(b."studentId", b."idEstudiante") AS sid,
              COALESCE(c."step", b."step")              AS step,
              COALESCE(c."tipo", b."tipoEvento")        AS tipo,
              b."nombreEvento",
              b."asistio",
              b."asistencia",
              b."participacion",
              b."noAprobo",
              b."cancelo"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
       WHERE COALESCE(b."studentId", b."idEstudiante") = $1`,
      [academicaId],
    );

    const overridesRows = await queryMany<{ step: string; isCompleted: boolean }>(
      `SELECT "step", "isCompleted" FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1 AND "isCompleted" IS NOT NULL`,
      [academicaId],
    );
    const overrides = new Map<string, boolean>();
    for (const o of overridesRows) overrides.set(o.step, o.isCompleted);

    const stepReal = computeStepReal(nivelActual, bookings, overrides);
    if (stepReal === null) {
      return { academicaId, status: 'error', error: `Nivel ${nivelActual} no soportado` };
    }

    if (stepReal <= stepActual) {
      return { academicaId, status: 'already_synced',
        from: { nivel: nivelActual, step: stepActualName ?? '' } };
    }

    const targetStepName = `Step ${stepReal}`;
    const result = await changeStep(academicaId, targetStepName);

    const nivelNuevo = result.isParallel
      ? (result.updatedFields as any).nivelParalelo
      : (result.updatedFields as any).nivel;

    const ahora = new Date().toISOString();
    const auditEntry = {
      fecha: ahora,
      nivelAnterior: nivelActual,
      stepAnterior:  stepActualName,
      nivelNuevo,
      stepNuevo:     targetStepName,
      motivo:        `[Reconciliación Usuarios Pegados] ${motivo}`,
      autorizadoPor: realizadoPor,
      realizadoPor,
      comentario:    null,
    };
    await AcademicaRepository.saveCambioStepHistory(academicaId, auditEntry);

    if (academic.numeroId) {
      const person = await PeopleRepository
        .findBeneficiarioByNumeroId(academic.numeroId)
        .catch(() => null);
      if (person) {
        const commentObj = {
          id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          texto: `[Reconciliación Usuarios Pegados] ${stepActualName} → ${targetStepName}. ${motivo}`,
          usuario: realizadoPor,
          fecha: ahora,
          areaRemitente: 'Académico',
          areaDestinatario: 'General',
        };
        await PeopleRepository.appendComment(person._id, JSON.stringify(commentObj))
          .catch(() => null);
      }
    }

    return {
      academicaId,
      status: 'ok',
      from: { nivel: nivelActual, step: stepActualName ?? '' },
      to:   { nivel: nivelNuevo,  step: targetStepName },
    };
  } catch (err: any) {
    return { academicaId, status: 'error', error: err?.message ?? 'Error desconocido' };
  }
}
