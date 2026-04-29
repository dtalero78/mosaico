/**
 * Student Service
 *
 * Business logic for student profiles, academic history, step changes,
 * and status management.
 */

import 'server-only';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { PeopleRepository } from '@/repositories/people.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { query, queryOne, queryMany } from '@/lib/postgres';

/**
 * Get student profile.
 * Prioritizes ACADEMICA (beneficiaries), falls back to PEOPLE (titulares).
 * Also looks up login password from USUARIOS_ROLES by email.
 */
export async function getProfile(id: string) {
  // Try ACADEMICA first (has JOIN with PEOPLE for full profile)
  const profile = await AcademicaRepository.findProfileById(id);
  if (profile) {
    profile.existeEnAcademica = true;
    return enrichWithLoginPassword(profile);
  }

  // Fallback to PEOPLE (for titulares without academic record)
  const person = await PeopleRepository.findByIdOrNumeroId(id);
  if (!person) throw new NotFoundError('Student', id);
  person.existeEnAcademica = false;
  return enrichWithLoginPassword(person);
}

/**
 * Look up USUARIOS_ROLES.password by email and attach as claveLogin.
 */
async function enrichWithLoginPassword(profile: any) {
  if (!profile?.email) return profile;
  try {
    const user = await queryOne(
      `SELECT "password" FROM "USUARIOS_ROLES" WHERE "email" = $1`,
      [profile.email]
    );
    if (user?.password) {
      const isBcrypt = user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$');
      profile.claveLogin = isBcrypt ? '(Encriptada)' : user.password;
    }
  } catch (e) {
    // Non-critical — don't fail the profile
  }
  return profile;
}

/**
 * Get academic history: academic record + class list.
 */
export async function getAcademicHistory(id: string, limit: number = 100) {
  // Try ACADEMICA by any ID field
  let academicRecord = await AcademicaRepository.findByAnyId(id);

  // Fallback: find person, then look up ACADEMICA by numeroId
  if (!academicRecord) {
    const person = await PeopleRepository.findByIdOrNumeroId(id);
    if (person?.numeroId) {
      academicRecord = await AcademicaRepository.findByNumeroId(person.numeroId);
    }
  }

  if (!academicRecord) throw new NotFoundError('Academic record', id);

  // Get class history using the student's _id
  const rawClasses = await BookingRepository.findByStudentId(academicRecord._id, limit);

  // Normalize: asistio is the source of truth (asistencia column has stale/inverted data from migration)
  const classes = rawClasses.map((c: any) => ({
    ...c,
    asistencia: c.asistio != null ? c.asistio : c.asistencia,
  }));

  return {
    academicRecord,
    classes,
    totalClasses: classes.length,
  };
}

/**
 * Update student fields (whitelisted).
 */
const ALLOWED_UPDATE_FIELDS = [
  'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
  'email', 'celular', 'telefono', 'fechaNacimiento', 'genero',
  'ciudad', 'domicilio', 'nivel', 'step', 'nivelParalelo', 'stepParalelo',
  'plataforma', 'plan', 'contrato', 'vigencia', 'finalContrato',
  'estadoInactivo', 'empresa', 'cargo', 'ingresos', 'medioPago',
  'asesor', 'agenteAsignado', 'asesorAsignado',
  'comentarios', 'comentariosAdministrativo', 'observacionesContrato',
  'tipoUsuario', 'estado', 'numeroId',
];

export async function updateStudent(id: string, body: Record<string, any>) {
  const student = await PeopleRepository.updateFields(id, body, ALLOWED_UPDATE_FIELDS);
  if (!student) throw new ValidationError('No valid fields to update');
  return student;
}

/**
 * Toggle student active/inactive status.
 * Returns null if status is already the same (no-op).
 */
export async function toggleStatus(id: string, active: boolean) {
  const person = await PeopleRepository.findByIdOrThrow(id);

  const currentlyInactive = person.estadoInactivo === true;
  const wantInactive = !active;

  if (currentlyInactive === wantInactive) {
    return { student: person, statusChanged: false };
  }

  const updated = await PeopleRepository.toggleStatus(id, wantInactive);

  // Sync estadoInactivo in ACADEMICA (match by numeroId)
  if (person.numeroId) {
    try {
      await query(
        `UPDATE "ACADEMICA" SET "estadoInactivo" = $1, "_updatedDate" = NOW() WHERE "numeroId" = $2`,
        [wantInactive, person.numeroId]
      );
    } catch (err) {
      console.warn('⚠️ Could not sync ACADEMICA.estadoInactivo for', person.numeroId, err);
    }
  }

  // Sync login access in USUARIOS_ROLES
  if (person.email) {
    try {
      await query(
        `UPDATE "USUARIOS_ROLES" SET "activo" = $1, "_updatedDate" = NOW() WHERE LOWER("email") = LOWER($2)`,
        [!wantInactive, person.email]
      );
    } catch (err) {
      console.warn('⚠️ Could not sync USUARIOS_ROLES.activo for', person.email, err);
    }
  }

  return {
    student: updated,
    statusChanged: true,
    previousStatus: currentlyInactive,
    newStatus: wantInactive,
  };
}

// --- Auto-advance helpers ---

function extractStepNum(stepName: string): number | null {
  const match = stepName?.match(/Step\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function isJumpStep(stepName: string): boolean {
  const num = extractStepNum(stepName);
  return num !== null && num > 0 && num % 5 === 0;
}

function isExitosa(c: any): boolean {
  const stepName = c.step || c.nombreEvento || '';
  const esJump = isJumpStep(stepName);
  return c.asistio === true || c.asistencia === true || (esJump && c.participacion === true);
}

function getClassType(c: any): 'SESSION' | 'CLUB' | 'OTHER' {
  if (c.tipo === 'SESSION' || c.tipo === 'COMPLEMENTARIA') return 'SESSION';
  if (c.tipo === 'CLUB') return 'CLUB';
  if (!c.tipo && c.step) {
    if (/^TRAINING\s*-/i.test(c.step)) return 'CLUB';
    if (/^Step\s+\d+$/i.test(c.step)) return 'SESSION';
  }
  return 'OTHER';
}

async function isCurrentStepComplete(
  studentId: string,
  nivel: string,
  stepName: string,
  overrideStudentId: string
): Promise<boolean> {
  const stepNum = extractStepNum(stepName);
  if (stepNum === null) return false;

  // Manual overrides have absolute priority
  const { StepOverridesRepository } = await import('@/repositories/niveles.repository');
  const override = await StepOverridesRepository.findByStudentAndStep(overrideStudentId, stepName);
  if (override !== null) return override.isCompleted === true;

  const esJump = isJumpStep(stepName);

  const allNivelClasses = await queryMany(
    `SELECT b."tipo", b."nombreEvento", b."asistio", b."asistencia", b."participacion", b."noAprobo",
            COALESCE(c."step", b."step") AS "step"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
     WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
       AND COALESCE(c."nivel", b."nivel") = $2
       AND (b."cancelo" IS NULL OR b."cancelo" = false)`,
    [studentId, nivel]
  );

  const clasesDelStep = allNivelClasses.filter(
    (c: any) => extractStepNum(c.step) === stepNum
  );

  const tieneNoAprobo = clasesDelStep.some((c: any) => c.noAprobo === true);

  if (esJump) {
    // Jump Step requires: at least 1 exitosa attendance AND noAprobo != true
    const tieneAsistenciaExitosa = clasesDelStep.some((c: any) => isExitosa(c));
    return clasesDelStep.length > 0 && tieneAsistenciaExitosa && !tieneNoAprobo;
  }

  const sesionesExitosas = clasesDelStep.filter((c: any) => getClassType(c) === 'SESSION' && isExitosa(c)).length;
  // Only TRAINING clubs count toward step completion
  const trainingClubsExitosos = clasesDelStep.filter((c: any) => {
    if (getClassType(c) !== 'CLUB') return false;
    const name = c.step || c.nombreEvento || '';
    return /^TRAINING\s*-/i.test(name) && isExitosa(c);
  }).length;
  return sesionesExitosas >= 2 && trainingClubsExitosos >= 1 && !tieneNoAprobo;
}

/**
 * Auto-advance student to the next step if their current step is now complete.
 * Called after an advisor saves an evaluation.
 *
 * Rules:
 * - Only advances if the booking is for the student's CURRENT step (not a past step).
 * - Skips WELCOME and ESS levels.
 * - Respects STEP_OVERRIDES (manual overrides have absolute priority).
 * - Returns null if no advancement happened, or details of the new step.
 */
export async function autoAdvanceStep(bookingId: string) {
  const booking = await BookingRepository.findBookingById(bookingId);
  if (!booking) return null;

  const studentId = booking.studentId || booking.idEstudiante;
  // Normalize nivel: "BN1 - Step 5" (tituloONivel stored as nivel) → "BN1"
  const bookingNivel = (booking.nivel || '').split(' - ')[0].trim() || booking.nivel;
  const bookingStep = booking.step;

  if (!studentId || !bookingNivel || !bookingStep) return null;
  if (bookingNivel === 'ESS') return null;

  // Get student's current nivel/step
  let student: any = await AcademicaRepository.findByAnyId(studentId);
  if (!student) student = await PeopleRepository.findByIdOrNumeroId(studentId);
  if (!student) return null;

  // ─── WELCOME → BN1 Step 1: promote on attendance ───
  if (bookingStep === 'WELCOME' || bookingNivel === 'WELCOME') {
    // Only promote if student is currently in WELCOME
    if (student.nivel !== 'WELCOME' && student.step !== 'WELCOME') return null;
    // Only promote if the booking has attendance marked
    if (!booking.asistio && !booking.asistencia) return null;
    console.log(`🎓 [AutoAdvance] WELCOME → BN1 Step 1 for student ${studentId}`);
    await changeStep(studentId, 'Step 1');
    return {
      advanced: true,
      from: { nivel: 'WELCOME', step: 'WELCOME' },
      to: { nivel: 'BN1', step: 'Step 1' },
    };
  }

  if (extractStepNum(bookingStep) === null) return null;

  // Only advance if the booking is for the student's CURRENT step
  if (student.nivel !== bookingNivel || student.step !== bookingStep) return null;

  // Resolve overrideStudentId (STEP_OVERRIDES uses PEOPLE _id)
  let overrideStudentId = student._id;
  if (student.numeroId) {
    const peopleRecord = await PeopleRepository.findByIdOrNumeroId(student.numeroId);
    if (peopleRecord) overrideStudentId = peopleRecord._id;
  }

  const isComplete = await isCurrentStepComplete(
    studentId,
    student.nivel,   // use student's actual nivel from ACADEMICA for class lookup
    bookingStep,
    overrideStudentId
  );
  if (!isComplete) return null;

  // Find next step
  const nextStepName = `Step ${extractStepNum(bookingStep)! + 1}`;
  const { NivelesRepository } = await import('@/repositories/niveles.repository');
  const nextNivelInfo = await NivelesRepository.findByStepName(nextStepName);
  if (!nextNivelInfo) {
    // No next step — student has completed the entire program (e.g., Step 45).
    // Block platform access by removing their login credentials from USUARIOS_ROLES.
    if (student.email) {
      await queryOne(
        `DELETE FROM "USUARIOS_ROLES" WHERE "email" = $1 RETURNING "email"`,
        [student.email]
      );
    }
    return {
      advanced: false,
      graduated: true,
      from: { nivel: bookingNivel, step: bookingStep },
      message: 'Programa completado. Acceso a la plataforma bloqueado.',
    };
  }

  await changeStep(studentId, nextStepName);

  return {
    advanced: true,
    from: { nivel: bookingNivel, step: bookingStep },
    to: { nivel: nextNivelInfo.code, step: nextStepName },
  };
}

/**
 * Change student step (regular or parallel level).
 * Updates both PEOPLE and ACADEMICA tables.
 */
export async function changeStep(
  id: string,
  newStep: string
) {
  // Try ACADEMICA first (the /student/[id] page uses ACADEMICA _id)
  const academic = await AcademicaRepository.findByAnyId(id);

  // Resolve PEOPLE record — only BENEFICIARIO should be updated.
  // Priority: academic.usuarioId (direct _id link) → findBeneficiarioByNumeroId → fallback
  let person: any = null;
  if (academic) {
    if (academic.usuarioId) {
      const candidate = await PeopleRepository.findById(academic.usuarioId);
      if (candidate && (candidate as any).tipoUsuario === 'BENEFICIARIO') {
        person = candidate;
      }
    }
    if (!person && academic.numeroId) {
      person = await PeopleRepository.findBeneficiarioByNumeroId(academic.numeroId);
    }
  } else {
    // No ACADEMICA record — fall back to direct PEOPLE lookup
    person = await PeopleRepository.findByIdOrNumeroId(id);
  }

  const numeroId = academic?.numeroId || (person as any)?.numeroId;
  if (!academic && !person) throw new NotFoundError('Student', id);

  // Look up the nivel info for this step
  const { NivelesRepository } = await import('@/repositories/niveles.repository');
  const nivelInfo = await NivelesRepository.findByStepName(newStep);
  if (!nivelInfo) throw new NotFoundError('Step', newStep);

  const isParallel = nivelInfo.esParalelo === true;
  const nivel = nivelInfo.code;

  // Update ACADEMICA
  if (numeroId) {
    await AcademicaRepository.updateStep(numeroId, nivel, newStep, isParallel);
  }

  // Update PEOPLE
  let updatedPerson = person;
  if (person) {
    updatedPerson = await PeopleRepository.updateStep(person._id, nivel, newStep, isParallel);
  }

  const fieldNames = isParallel
    ? { nivelParalelo: nivel, stepParalelo: newStep }
    : { nivel, step: newStep };

  return {
    student: updatedPerson || academic,
    isParallel,
    updatedFields: fieldNames,
  };
}
