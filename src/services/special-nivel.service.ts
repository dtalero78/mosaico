/**
 * Special Niveles Service
 *
 * Handles auto-advance logic for special end-of-program niveles:
 * MASTER, IELS, B2FIRST, TOEFL.
 *
 * Each of these niveles has a single step (46, 47, 48, 49 respectively).
 * Students reach these niveles after passing F3 Step 45 (Jump) based on
 * their selection in ACADEMICA.pruebainter:
 *   - NULL  → MASTER  (Step 46)
 *   - 'IELS' → IELS    (Step 47)
 *   - 'B2F'  → B2FIRST (Step 48)
 *   - 'TOEF' → TOEFL   (Step 49)
 *
 * Promotion to DONE Step 50:
 *   - MASTER  → when finalContrato < today (or manual admin promotion)
 *   - IELS    → when 100 days passed since promotion OR finalContrato < today
 *   - B2FIRST → same as IELS
 *   - TOEFL   → same as IELS
 *
 * When promoted to Step 50, the student is blocked: USUARIOS_ROLES.activo=false
 * + estadoInactivo=true in ACADEMICA + PEOPLE.
 */

import 'server-only';
import { query, queryOne } from '@/lib/postgres';

export const SPECIAL_NIVELES = ['MASTER', 'IELS', 'B2FIRST', 'TOEFL'] as const;
export type SpecialNivel = (typeof SPECIAL_NIVELES)[number];

// Days after promotion to IELS/B2FIRST/TOEFL before auto-promotion to DONE
const IELS_PROMOTION_DAYS = 100;

export function isSpecialNivel(nivel: string | null | undefined): nivel is SpecialNivel {
  return !!nivel && (SPECIAL_NIVELES as readonly string[]).includes(nivel);
}

/**
 * Map pruebainter value to target nivel/step.
 * Used when promoting from F3 Step 45 (Jump approved).
 */
export function resolvePruebaInterTarget(pruebainter: string | null | undefined): {
  nivel: SpecialNivel;
  step: string;
} {
  switch ((pruebainter || '').toUpperCase()) {
    case 'IELS': return { nivel: 'IELS',    step: 'Step 47' };
    case 'B2F':  return { nivel: 'B2FIRST', step: 'Step 48' };
    case 'TOEF': return { nivel: 'TOEFL',   step: 'Step 49' };
    default:     return { nivel: 'MASTER',  step: 'Step 46' };
  }
}

export interface AdvanceResult {
  advanced:   boolean;
  graduated?: boolean;
  from?:      { nivel: string; step: string };
  to?:        { nivel: string; step: string };
  message?:   string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(from: Date | string, to: Date = new Date()): number {
  const d1 = new Date(from);
  const d2 = to;
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function isContractExpired(finalContrato: any): boolean {
  if (!finalContrato) return false;
  const end = new Date(finalContrato);
  const today = new Date();
  end.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return end < today;
}

/**
 * Lookup PEOPLE.finalContrato by ACADEMICA's numeroId (where the field lives).
 */
async function getFinalContrato(student: any): Promise<string | null> {
  if (student.finalContrato) return student.finalContrato;
  if (!student.numeroId) return null;
  const row = await queryOne<{ finalContrato: string | null }>(
    `SELECT "finalContrato" FROM "PEOPLE"
     WHERE "numeroId" = $1
     ORDER BY CASE WHEN "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') THEN 0 ELSE 1 END
     LIMIT 1`,
    [student.numeroId]
  ).catch(() => null);
  return row?.finalContrato ?? null;
}

/**
 * Promote student to DONE Step 50 and block their platform access.
 * Updates ACADEMICA + PEOPLE (matched by numeroId) + USUARIOS_ROLES (by email).
 * Used by promoteFromX() functions AND by changeStep() when admin manually
 * moves a student to Step 50.
 */
export async function promoteToDoneAndBlock(
  student: any,
  reason: string = 'auto-promoted to DONE'
): Promise<AdvanceResult> {
  const fromNivel = student.nivel ?? '';
  const fromStep  = student.step  ?? '';

  // 1. ACADEMICA: nivel=DONE, step=Step 50, estadoInactivo=true
  if (student._id) {
    await query(
      `UPDATE "ACADEMICA"
       SET "nivel" = 'DONE', "step" = 'Step 50',
           "estadoInactivo" = true, "_updatedDate" = NOW()
       WHERE "_id" = $1`,
      [student._id]
    ).catch(err => console.warn('[special-nivel] ACADEMICA update failed:', err.message));
  }

  // 2. PEOPLE: nivel/step + estadoInactivo + aprobacion (matched by numeroId, prefer BENEFICIARIO)
  if (student.numeroId) {
    await query(
      `UPDATE "PEOPLE"
       SET "nivel" = 'DONE', "step" = 'Step 50',
           "estadoInactivo" = true, "aprobacion" = 'FINALIZADA',
           "_updatedDate" = NOW()
       WHERE "_id" = (
         SELECT "_id" FROM "PEOPLE"
         WHERE "numeroId" = $1
         ORDER BY CASE WHEN "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') THEN 0 ELSE 1 END
         LIMIT 1
       )`,
      [student.numeroId]
    ).catch(err => console.warn('[special-nivel] PEOPLE update failed:', err.message));
  }

  // 3. USUARIOS_ROLES: block login
  if (student.email) {
    await query(
      `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
       WHERE LOWER("email") = LOWER($1)`,
      [student.email]
    ).catch(err => console.warn('[special-nivel] USUARIOS_ROLES block failed:', err.message));
  }

  console.log(`🎓 [special-nivel] ${fromNivel} ${fromStep} → DONE Step 50 (${reason})`);

  return {
    advanced:  true,
    graduated: true,
    from: { nivel: fromNivel, step: fromStep },
    to:   { nivel: 'DONE', step: 'Step 50' },
    message: `Promovido a DONE Step 50: ${reason}. Acceso a la plataforma bloqueado.`,
  };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Routes auto-advance to the matching promoteFromX function.
 * Returns null if no promotion conditions are met (student stays in place).
 */
export async function autoAdvanceSpecialNivel(
  student: any,
  booking: any
): Promise<AdvanceResult | null> {
  switch (student.nivel as SpecialNivel) {
    case 'MASTER':  return promoteFromMaster(student, booking);
    case 'IELS':    return promoteFromIels(student, booking);
    case 'B2FIRST': return promoteFromB2First(student, booking);
    case 'TOEFL':   return promoteFromToefl(student, booking);
    default:        return null;
  }
}

// ── Promotion functions per nivel ────────────────────────────────────────────

/**
 * MASTER → DONE: only when finalContrato < today.
 * Manual admin promotion to Step 50 is handled by changeStep() in student.service.
 */
async function promoteFromMaster(student: any, _booking: any): Promise<AdvanceResult | null> {
  const finalContrato = await getFinalContrato(student);
  if (!isContractExpired(finalContrato)) return null;
  return promoteToDoneAndBlock(student, `contrato vencido (${finalContrato})`);
}

/**
 * IELS → DONE: 100 days since fechaPromocionEspecial OR finalContrato < today.
 */
async function promoteFromIels(student: any, _booking: any): Promise<AdvanceResult | null> {
  return promoteFromIelsLike(student, 'IELS');
}

async function promoteFromB2First(student: any, _booking: any): Promise<AdvanceResult | null> {
  return promoteFromIelsLike(student, 'B2FIRST');
}

async function promoteFromToefl(student: any, _booking: any): Promise<AdvanceResult | null> {
  return promoteFromIelsLike(student, 'TOEFL');
}

/**
 * Shared logic for IELS/B2FIRST/TOEFL: 100 days OR contract expired.
 */
async function promoteFromIelsLike(student: any, nivelName: string): Promise<AdvanceResult | null> {
  // Check 1: 100 days since promotion to special nivel
  const fechaPromocion = (student as any).fechaPromocionEspecial;
  if (fechaPromocion) {
    const days = daysBetween(fechaPromocion);
    if (days >= IELS_PROMOTION_DAYS) {
      return promoteToDoneAndBlock(
        student,
        `${days} días desde promoción a ${nivelName} (límite: ${IELS_PROMOTION_DAYS})`
      );
    }
  }

  // Check 2: contract expired
  const finalContrato = await getFinalContrato(student);
  if (isContractExpired(finalContrato)) {
    return promoteToDoneAndBlock(student, `contrato vencido (${finalContrato})`);
  }

  return null;
}
