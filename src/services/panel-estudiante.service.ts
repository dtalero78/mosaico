/**
 * Panel Estudiante Service
 *
 * Business logic for the student-facing portal.
 * Resolves the logged-in student from their session, then delegates
 * to existing repositories for data fetching.
 *
 * IMPORTANT: Students have TWO records — PEOPLE (personal data) and ACADEMICA
 * (academic data with nivel/step). Bookings reference the ACADEMICA._id via
 * "idEstudiante", NOT the PEOPLE._id. This service merges both records and
 * exposes `academicaId` for booking queries.
 */

import 'server-only';
import { Session } from 'next-auth';
import { query } from '@/lib/postgres';
import { PeopleRepository } from '@/repositories/people.repository';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { NivelesRepository } from '@/repositories/niveles.repository';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { generateReport } from '@/services/progress.service';
import { getEffectiveStepNumber } from '@/services/student-booking.service';

// One-time migration: ensure fechaInicioESS column exists in ACADEMICA and PEOPLE
let essMigrationDone = false;
async function ensureESSColumns() {
  if (essMigrationDone) return;
  try {
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "fechaInicioESS" TIMESTAMPTZ`, []);
    await query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "fechaInicioESS" TIMESTAMPTZ`, []);
    essMigrationDone = true;
  } catch (err: any) {
    console.error('⚠️ [ESS] Error ensuring fechaInicioESS columns:', err.message);
  }
}

/** Days a student stays in ESS (Essential) before auto-promoting to BN1 Step 1 */
const ESS_DURATION_DAYS = 30;

/**
 * Resolve the student from the session.
 * Returns a merged PEOPLE + ACADEMICA object with `academicaId` for booking queries.
 *
 * Lookup chain:
 *   1. PEOPLE by email (session.user.email)
 *   2. ACADEMICA by PEOPLE.numeroId (links the two tables)
 *   3. Merge: PEOPLE base + ACADEMICA overrides (nivel, step, academicaId)
 */
export async function resolveStudentFromSession(session: Session) {
  await ensureESSColumns();

  const role = (session.user as any)?.role;
  if (role !== 'ESTUDIANTE') {
    throw new ForbiddenError('Solo estudiantes pueden acceder a este panel');
  }

  const email = session.user?.email;
  if (!email) {
    throw new ForbiddenError('No se encontró email en la sesión');
  }

  // Lookup chain (ACADEMICA-first to avoid TITULAR/BENEFICIARIO email collision):
  // 1. ACADEMICA by email → PEOPLE by ACADEMICA.numeroId (with BENEFICIARIO preference)
  // 2. Fallback: PEOPLE by email → ACADEMICA by PEOPLE.numeroId
  let person = null;
  let academica = await AcademicaRepository.findByEmail(email);

  if (academica) {
    // Found academic record — find the matching PEOPLE (BENEFICIARIO) via numeroId
    if (academica.numeroId) {
      person = await PeopleRepository.findBeneficiarioByNumeroId(academica.numeroId);
      if (!person) {
        // Fallback: any PEOPLE with that numeroId
        person = await PeopleRepository.findByIdOrNumeroId(academica.numeroId);
      }
    }
  } else {
    // ACADEMICA not found by email — try PEOPLE first, then ACADEMICA by numeroId
    person = await PeopleRepository.findByEmail(email);
    if (person && person.numeroId) {
      academica = await AcademicaRepository.findByNumeroId(person.numeroId);
    }
    if (!person && !academica) {
      throw new NotFoundError('Estudiante', email);
    }
  }

  // Build a base object from whichever source we have
  const base = person ?? academica;
  if (!base) {
    throw new NotFoundError('Estudiante', email);
  }

  const academicaId: string | null = academica?._id ?? null;
  let nivel: string | null = academica?.nivel ?? (base as any).nivel ?? null;
  let step: string | null = academica?.step ?? (base as any).step ?? null;
  let nivelParalelo: string | null = academica?.nivelParalelo ?? (base as any).nivelParalelo ?? null;
  let stepParalelo: string | null = academica?.stepParalelo ?? (base as any).stepParalelo ?? null;

  // Calculate the effective step (first incomplete step based on real progress)
  const effectiveStepNum = nivel
    ? await getEffectiveStepNumber(academicaId ?? (base as any)._id, nivel)
    : 0;
  const effectiveStep = effectiveStepNum > 0 ? `Step ${effectiveStepNum}` : step;

  // Check OnHold auto-reactivation: if fechaFinOnHold < today, deactivate OnHold + extend contract
  const fechaFinOnHold = (base as any).fechaFinOnHold;
  const fechaOnHold = (base as any).fechaOnHold;
  if (fechaFinOnHold && fechaOnHold && (base as any).estadoInactivo) {
    const endOnHold = new Date(fechaFinOnHold);
    const todayOnHold = new Date();
    todayOnHold.setHours(0, 0, 0, 0);
    endOnHold.setHours(0, 0, 0, 0);

    if (endOnHold < todayOnHold) {
      console.log(`🟢 [Panel Estudiante] OnHold expirado (${fechaFinOnHold}). Reactivando estudiante y extendiendo contrato.`);

      // Calculate paused days
      const startOnHold = new Date(fechaOnHold);
      const daysPaused = Math.ceil(
        (endOnHold.getTime() - startOnHold.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Extend contract by paused days
      const currentFinal = (base as any).finalContrato ? new Date((base as any).finalContrato) : null;
      let newFinalStr: string | null = null;
      let newVigencia = 0;

      if (currentFinal) {
        const newFinal = new Date(currentFinal);
        newFinal.setDate(newFinal.getDate() + daysPaused);
        newFinalStr = newFinal.toISOString().split('T')[0];
        newVigencia = Math.ceil((newFinal.getTime() - todayOnHold.getTime()) / (1000 * 60 * 60 * 24));

        // Build extension history
        const currentExtHistory = Array.isArray((base as any).extensionHistory) ? (base as any).extensionHistory : [];
        const extensionEntry = {
          numero: ((base as any).extensionCount || 0) + 1,
          fechaEjecucion: new Date().toISOString(),
          vigenciaAnterior: currentFinal.toISOString().split('T')[0],
          vigenciaNueva: newFinalStr,
          diasExtendidos: daysPaused,
          motivo: `Extensión automática por OnHold (${daysPaused} días pausados desde ${fechaOnHold} hasta ${fechaFinOnHold})`,
        };
        const updatedExtHistory = [...currentExtHistory, extensionEntry];

        await query(
          `UPDATE "PEOPLE"
           SET "estadoInactivo" = false,
               "fechaOnHold" = NULL,
               "fechaFinOnHold" = NULL,
               "finalContrato" = $1::date,
               "vigencia" = $2,
               "extensionCount" = COALESCE("extensionCount", 0) + 1,
               "extensionHistory" = $3::jsonb,
               "_updatedDate" = NOW()
           WHERE "_id" = $4`,
          [newFinalStr, newVigencia, JSON.stringify(updatedExtHistory), (base as any)._id]
        );
      } else {
        // No contract date — just clear OnHold fields
        await query(
          `UPDATE "PEOPLE"
           SET "estadoInactivo" = false,
               "fechaOnHold" = NULL,
               "fechaFinOnHold" = NULL,
               "_updatedDate" = NOW()
           WHERE "_id" = $1`,
          [(base as any)._id]
        );
      }

      (base as any).estadoInactivo = false;
      (base as any).fechaOnHold = null;
      (base as any).fechaFinOnHold = null;
      if (newFinalStr) {
        (base as any).finalContrato = newFinalStr;
        (base as any).vigencia = newVigencia;
      }

      // Restore login access in USUARIOS_ROLES
      if ((base as any).email) {
        try {
          await query(
            `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW() WHERE LOWER("email") = LOWER($1)`,
            [(base as any).email]
          );
        } catch (err) {
          console.warn('⚠️ Could not sync USUARIOS_ROLES on OnHold auto-reactivation:', err);
        }
      }
    }
  }

  // ESS auto-promotion: nivel = 'ESS' is the Essential level (Step 0).
  // After ESS_DURATION_DAYS (30) days from fechaInicioESS, promote to BN1 Step 1.
  if (nivel === 'ESS' && academicaId) {
    const fechaInicioESS = (academica as any)?.fechaInicioESS ?? (base as any)?.fechaInicioESS;
    if (fechaInicioESS) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const inicio = new Date(fechaInicioESS);
      inicio.setHours(0, 0, 0, 0);
      const daysSince = Math.ceil((today.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince >= ESS_DURATION_DAYS) {
        console.log(`🎓 [Panel Estudiante] ESS completado (${daysSince} días). Promoviendo a BN1 Step 1.`);
        try {
          await query(
            `UPDATE "ACADEMICA"
             SET "nivel" = 'BN1', "step" = 'Step 1',
                 "fechaInicioESS" = NULL,
                 "_updatedDate" = NOW()
             WHERE "_id" = $1`,
            [academicaId]
          );
          if (person) {
            await query(
              `UPDATE "PEOPLE"
               SET "nivel" = 'BN1', "step" = 'Step 1',
                   "fechaInicioESS" = NULL,
                   "_updatedDate" = NOW()
               WHERE "_id" = $1`,
              [(person as any)._id]
            );
          }
          nivel = 'BN1';
          step = 'Step 1';
          console.log(`✅ [Panel Estudiante] Promoción ESS→BN1 Step 1 completada para ${email}`);
        } catch (err: any) {
          console.error('⚠️ [Panel Estudiante] Error en auto-promoción ESS:', err.message);
        }
      }
    }
  }

  // Check contract expiration: if finalContrato < today, inactivate student + titular
  const finalContrato = (base as any).finalContrato;
  if (finalContrato && !((base as any).estadoInactivo)) {
    const endDate = new Date(finalContrato);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < today) {
      console.log(`🔴 [Panel Estudiante] Contrato expirado (${finalContrato}). Inactivando estudiante y titular.`);

      // Inactivate this student in PEOPLE
      await query(
        `UPDATE "PEOPLE" SET "estadoInactivo" = true, "aprobacion" = 'FINALIZADA', "_updatedDate" = NOW() WHERE "_id" = $1`,
        [(base as any)._id]
      );
      (base as any).estadoInactivo = true;

      // Inactivate this student in ACADEMICA (by numeroId)
      if ((base as any).numeroId) {
        try {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = true, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
            [(base as any).numeroId]
          );
        } catch (err) {
          console.warn('⚠️ Could not sync ACADEMICA on contract expiration:', err);
        }
      }

      // Block login in USUARIOS_ROLES for this student and all contract members
      const contrato = (base as any).contrato;
      try {
        // Block this student's login
        if ((base as any).email) {
          await query(
            `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW() WHERE LOWER("email") = LOWER($1)`,
            [(base as any).email]
          );
        }
        // Block all contract members' login
        if (contrato) {
          await query(
            `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
             WHERE LOWER("email") IN (
               SELECT LOWER("email") FROM "PEOPLE" WHERE "contrato" = $1 AND "email" IS NOT NULL
             )`,
            [contrato]
          );
        }
      } catch (err) {
        console.warn('⚠️ Could not sync USUARIOS_ROLES on contract expiration:', err);
      }

      // Inactivate ALL members of this contract in PEOPLE (titular + all beneficiarios)
      if (contrato) {
        await query(
          `UPDATE "PEOPLE"
           SET "estadoInactivo" = true, "aprobacion" = 'FINALIZADA', "_updatedDate" = NOW()
           WHERE "contrato" = $1 AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)`,
          [contrato]
        );
        // Inactivate ACADEMICA for all beneficiarios of this contract
        try {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = true, "_updatedDate" = NOW()
             WHERE "numeroId" IN (
               SELECT "numeroId" FROM "PEOPLE"
               WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO' AND "numeroId" IS NOT NULL
             )`,
            [contrato]
          );
        } catch (err) {
          console.warn('⚠️ Could not sync ACADEMICA beneficiarios on contract expiration:', err);
        }
      }
    }
  }

  return {
    ...base,
    academicaId,  // ACADEMICA._id — use this for booking queries
    nivel,
    step,
    effectiveStep, // First incomplete step (used for display in header/card)
    nivelParalelo,
    stepParalelo,
    foto: academica?.foto ?? (base as any).foto ?? null, // photo from ACADEMICA
  };
}

/**
 * Get the full student profile (merged PEOPLE + ACADEMICA).
 * The resolveStudentFromSession already merges both, so this just
 * re-returns it — but also called from the /me route with the resolved student.
 */
export async function getStudentProfile(student: any) {
  return student;
}

/**
 * Get the student's upcoming (non-cancelled) events with advisor name and Zoom link.
 * Uses academicaId because bookings reference ACADEMICA._id via "idEstudiante".
 */
export async function getStudentUpcomingEvents(academicaId: string) {
  return BookingRepository.findUpcomingByStudentId(academicaId, 10);
}

/**
 * Get attendance statistics for the student.
 */
export async function getStudentStats(academicaId: string) {
  return BookingRepository.getStudentAttendanceStats(academicaId);
}

/**
 * Get the "¿Cómo voy?" progress report.
 * Passes the ACADEMICA _id so generateReport finds both the record and its bookings.
 */
export async function getStudentProgress(academicaId: string) {
  return generateReport(academicaId);
}

/**
 * Get the student's full class history.
 */
export async function getStudentHistory(academicaId: string) {
  const bookings = await BookingRepository.findByStudentId(academicaId, 500);
  return bookings.map((b: any) => ({
    ...b,
    advisor: b.tipo === 'COMPLEMENTARIA' ? 'PLATAFORMA' : b.advisor,
  }));
}

/**
 * Get downloadable materials for the student's current nivel.
 */
export async function getStudentMaterials(nivel: string) {
  return NivelesRepository.findByCode(nivel);
}

/**
 * Get advisor comments/annotations for the student.
 */
export async function getStudentComments(academicaId: string) {
  return BookingRepository.findCommentsForStudent(academicaId, 50);
}
