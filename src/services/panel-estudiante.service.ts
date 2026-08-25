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
import { query, queryOne } from '@/lib/postgres';
import { PeopleRepository } from '@/repositories/people.repository';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { NivelesRepository } from '@/repositories/niveles.repository';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { generateReport } from '@/services/progress.service';
import { getEffectiveStepNumber } from '@/services/student-booking.service';
import { isContractExpired } from '@/lib/contract-expiry';
import { inicioProximaSemanaUTC } from '@/lib/semana';

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

  // ─── Fase 2: la IDENTIDAD del alumno es su `userLogin`, no el email ───
  // Los hermanos comparten el email del apoderado, así que el email NO identifica
  // a una persona. Resolvemos la cuenta por `USUARIOS_ROLES._id` (único, = token.sub
  // de la sesión) → userLogin/numberid → ACADEMICA por userLogin. El email queda
  // solo como dato de contacto.
  const urId: string | null = (session.user as any)?.id ?? null;
  const email: string | null = session.user?.email ?? null;
  if (!urId && !email) {
    throw new ForbiddenError('No se encontró identidad en la sesión');
  }

  let userLogin: string | null = null;
  let numberid: string | null = null;
  if (urId) {
    const ur = await queryOne(
      `SELECT "userLogin", "numberid", "email" FROM "USUARIOS_ROLES" WHERE "_id" = $1 LIMIT 1`,
      [urId]
    );
    userLogin = (ur as any)?.userLogin ?? null;
    numberid = (ur as any)?.numberid ?? null;
  }

  // Lookup chain (por identidad única, con fallbacks para cuentas legacy):
  //   1. ACADEMICA por userLogin (identidad)
  //   2. ACADEMICA por numberid (= numeroId de la cuenta)
  //   3. ACADEMICA por email (último recurso; ambiguo si el email está compartido)
  let person = null;
  let academica = null;
  if (userLogin) academica = await AcademicaRepository.findByUserLogin(userLogin);
  if (!academica && numberid) academica = await AcademicaRepository.findByNumeroId(numberid);
  if (!academica && email) academica = await AcademicaRepository.findByEmail(email);

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
    // Sin ACADEMICA: resolver PEOPLE por numberid (preferido), luego por email.
    if (numberid) {
      person = await PeopleRepository.findBeneficiarioByNumeroId(numberid);
      if (!person) person = await PeopleRepository.findByIdOrNumeroId(numberid);
    }
    if (!person && email) {
      person = await PeopleRepository.findByEmail(email);
    }
    if (person && person.numeroId) {
      academica = await AcademicaRepository.findByNumeroId(person.numeroId);
    }
    if (!person && !academica) {
      throw new NotFoundError('Estudiante', userLogin || email || urId || 'sesión');
    }
  }

  // Build a base object from whichever source we have
  const base = person ?? academica;
  if (!base) {
    throw new NotFoundError('Estudiante', userLogin || email || 'sesión');
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

        // OnHold y Extensión son procesos independientes con contadores
        // separados. La auto-reactivación al login extiende finalContrato
        // por los días pausados pero NO toca extensionCount ni
        // extensionHistory (la traza queda en onHoldHistory).
        await query(
          `UPDATE "PEOPLE"
           SET "estadoInactivo" = false,
               "estado" = 'ACTIVA',
               "fechaOnHold" = NULL,
               "fechaFinOnHold" = NULL,
               "finalContrato" = $1::date,
               "vigencia" = $2,
               "_updatedDate" = NOW()
           WHERE "_id" = $3`,
          [newFinalStr, newVigencia, (base as any)._id]
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

      // Restore login access in USUARIOS_ROLES — key by the student's OWN account
      // (_id / userLogin), NOT by email (shared among siblings in Fase 2).
      if (urId || userLogin) {
        try {
          await query(
            `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW()
             WHERE ($1::text IS NOT NULL AND "_id" = $1)
                OR ($2::text <> '' AND "userLogin" = $2)`,
            [urId, userLogin ?? '']
          );
        } catch (err) {
          console.warn('⚠️ Could not sync USUARIOS_ROLES on OnHold auto-reactivation:', err);
        }
      }

      // Sync ACADEMICA.estadoInactivo (por numeroId). Sin esto el estudiante
      // puede loguear (USUARIOS_ROLES.activo=true) pero NO agendar (la
      // validación de booking bloquea cuando ACADEMICA.estadoInactivo=true).
      if ((base as any).numeroId) {
        try {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
            [(base as any).numeroId]
          );
        } catch (err) {
          console.warn('⚠️ Could not sync ACADEMICA on OnHold auto-reactivation:', err);
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

  // ─── Special niveles auto-promotion at login ───
  // For students in MASTER/IELS/B2FIRST/TOEFL: check if their special promotion
  // conditions are met (contract expired or 100 days for IELS/B2FIRST/TOEFL).
  // If so, promote them to DONE Step 50 and block their login.
  // This must run BEFORE the generic contract expiration block below.
  try {
    const { isSpecialNivel, autoAdvanceSpecialNivel } = await import('@/services/special-nivel.service');
    const currentNivel = academica?.nivel ?? (base as any).nivel;
    if (isSpecialNivel(currentNivel) && !((base as any).estadoInactivo)) {
      const studentForCheck = {
        _id: academica?._id ?? (base as any)._id,
        numeroId: academica?.numeroId ?? (base as any).numeroId,
        email: academica?.email ?? (base as any).email,
        nivel: currentNivel,
        step: academica?.step ?? (base as any).step,
        finalContrato: (base as any).finalContrato,
        fechaPromocionEspecial: (academica as any)?.fechaPromocionEspecial,
      };
      const result = await autoAdvanceSpecialNivel(studentForCheck, null);
      if (result?.graduated) {
        console.log(`🎓 [Panel Estudiante] Special nivel ${currentNivel} → DONE: ${result.message}`);
        // Reflect new state locally so downstream code sees inactivation
        (base as any).estadoInactivo = true;
        nivel = 'DONE';
        step = 'Step 50';
      }
    }
  } catch (err: any) {
    console.warn('⚠️ [Panel Estudiante] Special nivel check failed:', err.message);
  }

  // Check contract expiration: date-only comparison with +1 day grace
  // (see src/lib/contract-expiry.ts). Anyone NOT inactive whose finalContrato
  // is at least 2 calendar days in the past gets inactivated + their contract
  // members locked out.
  const finalContrato = (base as any).finalContrato;
  if (!((base as any).estadoInactivo) && isContractExpired(finalContrato)) {
    console.log(`🔴 [Panel Estudiante] Contrato expirado (${finalContrato}). Inactivando estudiante y titular.`);

    // Inactivate this student in PEOPLE.
    // Política unificada (mayo 2026): contratos vencidos sólo escriben
    // `estado='FINALIZADA'` + `estadoInactivo=true`. El campo `aprobacion`
    // refleja la decisión comercial (Aprobado/Pendiente/Retractado/…) y
    // NO debe sobrescribirse por vencimiento — evita la inconsistencia
    // previa donde el cron escribía `estado` y este flujo escribía
    // `aprobacion`, dejando datos divergentes.
    await query(
      `UPDATE "PEOPLE" SET "estadoInactivo" = true, "estado" = 'FINALIZADA', "_updatedDate" = NOW() WHERE "_id" = $1`,
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
      // Block this student's OWN login (by account _id / userLogin, not shared email)
      if (urId || userLogin) {
        await query(
          `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
           WHERE ($1::text IS NOT NULL AND "_id" = $1)
              OR ($2::text <> '' AND "userLogin" = $2)`,
          [urId, userLogin ?? '']
        );
      }
      // Block all contract members' login — match beneficiary numeroId ↔ USUARIOS_ROLES.numberid
      // (los alumnos tienen cuenta; el titular no). Normalizado (RUT con puntos/guiones).
      if (contrato) {
        await query(
          `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
           WHERE REPLACE(REPLACE(REPLACE("numberid",'.',''),'-',''),' ','') IN (
             SELECT REPLACE(REPLACE(REPLACE("numeroId",'.',''),'-',''),' ','')
               FROM "PEOPLE"
              WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO' AND "numeroId" IS NOT NULL
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
         SET "estadoInactivo" = true, "estado" = 'FINALIZADA', "_updatedDate" = NOW()
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
  // 3 h hacia atrás: quien ya generó su acceso a Zoom conserva el ícono hasta 10
  // min antes del final, y un bloque de IMPULSA dura 2h30. Con la ventana normal
  // de 10 min la clase se caía de la lista y se llevaba el ícono con ella.
  return BookingRepository.findUpcomingByStudentId(academicaId, 10, 180);
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
  // El historial muestra SOLO las clases pasadas + las de la semana corriente; se
  // ocultan las sesiones de semanas FUTURAS (fechaEvento < inicio de la próxima semana).
  const cutoff = await inicioProximaSemanaUTC();
  // Las sesiones de NIVELACIÓN no están mapeadas a una lección (sesionModulo/Leccion
  // = null); su target vive en ACADEMICA.detalleNivelacion. Se rellena para que la
  // tabla muestre el módulo/lección que se está reforzando.
  const niv = await getDetalleNivelacion(academicaId);
  return bookings
    .filter((b: any) => {
      if (!b.fechaEvento) return true; // sin fecha (raro) → conservar
      return new Date(b.fechaEvento).getTime() < cutoff;
    })
    .map((b: any) => {
    const esNiv = b.tipo === 'NIVELACION';
    return {
      ...b,
      advisor: b.tipo === 'COMPLEMENTARIA' ? 'PLATAFORMA' : b.advisor,
      sesionModulo: (esNiv && !b.sesionLeccion && niv?.modulo) ? niv.modulo : b.sesionModulo,
      sesionLeccion: (esNiv && !b.sesionLeccion && niv?.leccion) ? niv.leccion : b.sesionLeccion,
      esNivelacion: esNiv,
    };
  });
}

/** Lee y parsea ACADEMICA.detalleNivelacion (target de la nivelación actual). */
async function getDetalleNivelacion(academicaId: string): Promise<{ modulo?: string; leccion?: string } | null> {
  try {
    const r = await queryOne<{ detalleNivelacion: any }>(
      `SELECT "detalleNivelacion" FROM "ACADEMICA" WHERE "_id"=$1`, [academicaId]
    );
    let d: any = r?.detalleNivelacion;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
    return d && (d.modulo || d.leccion) ? d : null;
  } catch { return null; }
}

/**
 * Get downloadable materials for the student's current nivel.
 */
export async function getStudentMaterials(nivel: string, curso?: string) {
  // En MOSAICO el módulo (`code`) se repite entre cursos → hay que acotar por
  // curso para no mezclar el material (p.ej. YOJI con IMPULSA en "Modulo 01").
  if (curso) return NivelesRepository.findByCodeAndCurso(nivel, curso);
  return NivelesRepository.findByCode(nivel);
}

/**
 * Get advisor comments/annotations for the student.
 */
export async function getStudentComments(academicaId: string) {
  return BookingRepository.findCommentsForStudent(academicaId, 50);
}
