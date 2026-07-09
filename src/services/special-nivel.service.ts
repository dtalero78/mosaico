/**
 * Special Niveles Service
 *
 * Handles auto-advance logic for the 4 end-of-program niveles:
 * MASTER, IELTS, B2FIRST, TOEFL.
 *
 * Each of these niveles has a single step (46, 47, 48, 49 respectively).
 * Motor LGS heredado: en MOSAICO está dormido (no existen F3 ni los Steps
 * 46-49, y el proceso de Exámenes Internacionales fue retirado). La ruta de
 * fin de programa desde F3 Step 45 (Jump) usa MASTER (Step 46) por defecto.
 *
 * Behavior when finalContrato is expired (gracia +1 day rule, see
 * src/lib/contract-expiry.ts):
 *
 *   - MASTER (no international test selected) →
 *       Promote to DONE Step 50 + full block (USUARIOS_ROLES.activo=false,
 *       estadoInactivo=true in ACADEMICA + PEOPLE).
 *
 *   - IELTS / B2FIRST / TOEFL (test was selected at F3 Jump) →
 *       Stay in their current Step (47/48/49) but block: estadoInactivo=true
 *       in ACADEMICA + PEOPLE, USUARIOS_ROLES.activo=false. The level info
 *       is preserved so that if the contract is later extended, the student
 *       resumes exactly where they were.
 *
 * When finalContrato is NOT expired, the student stays active in their
 * special nivel indefinitely (the previous 100-day timer was removed).
 */

import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { isContractExpired } from '@/lib/contract-expiry';

export const SPECIAL_NIVELES = ['MASTER', 'IELTS', 'B2FIRST', 'TOEFL'] as const;
export type SpecialNivel = (typeof SPECIAL_NIVELES)[number];

export function isSpecialNivel(nivel: string | null | undefined): nivel is SpecialNivel {
  return !!nivel && (SPECIAL_NIVELES as readonly string[]).includes(nivel);
}

/**
 * Map a target key to nivel/step for the end-of-program promotion from
 * F3 Step 45 (Jump approved). En MOSAICO siempre se invoca con null → MASTER.
 */
export function resolveNivelacionGuiaTarget(target: string | null | undefined): {
  nivel: SpecialNivel;
  step: string;
} {
  switch ((target || '').toUpperCase()) {
    case 'IELTS':   return { nivel: 'IELTS',   step: 'Step 47' };
    case 'B2FIRST': return { nivel: 'B2FIRST', step: 'Step 48' };
    case 'TOEFL':   return { nivel: 'TOEFL',   step: 'Step 49' };
    default:        return { nivel: 'MASTER',  step: 'Step 46' };
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

  // 2. PEOPLE: nivel/step + estadoInactivo + estado (matched by numeroId, prefer BENEFICIARIO)
  // Política unificada (mayo 2026): bloqueo por vencimiento sólo escribe
  // `estado='FINALIZADA'`; `aprobacion` queda intacta (refleja la decisión
  // comercial original — Aprobado/Pendiente/etc).
  if (student.numeroId) {
    await query(
      `UPDATE "PEOPLE"
       SET "nivel" = 'DONE', "step" = 'Step 50',
           "estadoInactivo" = true, "estado" = 'FINALIZADA',
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

/**
 * Block a student in their CURRENT special step (do NOT move to Step 50).
 * Mirrors promoteToDoneAndBlock's inactivation cascade but preserves the
 * student's nivel/step so the level info (which international test they were
 * preparing) is not lost. Used for IELTS / B2FIRST / TOEFL when their
 * contract expires.
 */
export async function blockInCurrentSpecialStep(
  student: any,
  reason: string = 'contrato vencido — bloqueado en nivel especial'
): Promise<AdvanceResult> {
  const currentNivel = student.nivel ?? '';
  const currentStep  = student.step  ?? '';

  // 1. ACADEMICA: estadoInactivo only (preserve nivel/step)
  if (student._id) {
    await query(
      `UPDATE "ACADEMICA"
       SET "estadoInactivo" = true, "_updatedDate" = NOW()
       WHERE "_id" = $1`,
      [student._id]
    ).catch(err => console.warn('[special-nivel] ACADEMICA block failed:', err.message));
  }

  // 2. PEOPLE: estadoInactivo + estado (preserve nivel/step, preserve aprobacion).
  // Política unificada (mayo 2026): bloqueo por vencimiento sólo escribe
  // `estado='FINALIZADA'`; `aprobacion` queda intacta.
  if (student.numeroId) {
    await query(
      `UPDATE "PEOPLE"
       SET "estadoInactivo" = true, "estado" = 'FINALIZADA', "_updatedDate" = NOW()
       WHERE "_id" = (
         SELECT "_id" FROM "PEOPLE"
         WHERE "numeroId" = $1
         ORDER BY CASE WHEN "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') THEN 0 ELSE 1 END
         LIMIT 1
       )`,
      [student.numeroId]
    ).catch(err => console.warn('[special-nivel] PEOPLE block failed:', err.message));
  }

  // 3. USUARIOS_ROLES: block login
  if (student.email) {
    await query(
      `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
       WHERE LOWER("email") = LOWER($1)`,
      [student.email]
    ).catch(err => console.warn('[special-nivel] USUARIOS_ROLES block failed:', err.message));
  }

  console.log(`🔒 [special-nivel] ${currentNivel} ${currentStep} bloqueado (${reason})`);

  return {
    advanced:  true,
    graduated: true,   // signals to callers that the panel should treat this as terminal
    from: { nivel: currentNivel, step: currentStep },
    to:   { nivel: currentNivel, step: currentStep },
    message: `Bloqueado en ${currentNivel} ${currentStep}: ${reason}. Acceso a la plataforma bloqueado.`,
  };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Auto-advance for the 4 special niveles when finalContrato is expired:
 *   - MASTER → promoteToDoneAndBlock (DONE Step 50)
 *   - IELTS / B2FIRST / TOEFL → blockInCurrentSpecialStep (stays in 47/48/49)
 *
 * When finalContrato is not expired, returns null and the student stays active.
 */
export async function autoAdvanceSpecialNivel(
  student: any,
  _booking: any
): Promise<AdvanceResult | null> {
  if (!isSpecialNivel(student.nivel)) return null;

  const finalContrato = await getFinalContrato(student);
  if (!isContractExpired(finalContrato)) return null;

  if (student.nivel === 'MASTER') {
    return promoteToDoneAndBlock(student, `contrato vencido (${finalContrato})`);
  }

  // IELTS / B2FIRST / TOEFL: keep the level info, just block.
  return blockInCurrentSpecialStep(student, `contrato vencido (${finalContrato})`);
}
