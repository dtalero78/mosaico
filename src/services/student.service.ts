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

// Ensure ACADEMICA.fechaPromocionEspecial column exists (idempotent, once per server start).
// Written when student is promoted from F3 Step 45 to MASTER/IELS/B2FIRST/TOEFL;
// IELS/B2FIRST/TOEFL use it to compute the 100-day auto-promotion to DONE.
let fechaPromoEnsured = false;
async function ensureFechaPromocionEspecial() {
  if (fechaPromoEnsured) return;
  try {
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "fechaPromocionEspecial" TIMESTAMPTZ`, []);
    fechaPromoEnsured = true;
  } catch (err: any) {
    console.warn('[student.service] ensureFechaPromocionEspecial:', err.message);
  }
}

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
 * MOSAICO — Promueve un beneficiario desde el curso puente WELCOME a su curso REAL,
 * copiando campaign / curso / salón / nivel(módulo) / step(lección) desde PEOPLE a
 * ACADEMICA. Se dispara al asistir a la bienvenida o con el botón "Aprobar Welcome".
 * Idempotente: si PEOPLE no tiene curso real, no rompe. Registra en cambioStepHistory.
 * @param academicId  ACADEMICA._id
 */
/**
 * Preview (solo lectura) del curso REAL al que se promovería al beneficiario desde
 * el curso puente WELCOME. No muta nada — alimenta el modal de confirmación.
 */
export async function previewPromoteFromWelcome(academicId: string) {
  const academic = await queryOne<any>(
    `SELECT "_id", "peopleId", "numeroId", "primerNombre", "segundoNombre", "primerApellido",
            "segundoApellido", "curso", "nivel", "step", "salon" FROM "ACADEMICA" WHERE "_id" = $1`,
    [academicId]
  );
  if (!academic) throw new NotFoundError('Registro académico', academicId);

  let people = academic.peopleId
    ? await queryOne<any>(`SELECT "campaign", "tipoCurso", "salon", "nivel", "step" FROM "PEOPLE" WHERE "_id" = $1`, [academic.peopleId])
    : null;
  if (!people) {
    people = await queryOne<any>(
      `SELECT "campaign", "tipoCurso", "salon", "nivel", "step" FROM "PEOPLE"
       WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
       ORDER BY "_createdDate" DESC NULLS LAST LIMIT 1`,
      [academic.numeroId]
    );
  }
  if (!people) throw new NotFoundError('PEOPLE del beneficiario', academicId);

  const nombre = [academic.primerNombre, academic.segundoNombre, academic.primerApellido, academic.segundoApellido]
    .filter(Boolean).join(' ').trim();

  return {
    nombre,
    numeroId: academic.numeroId || null,
    actual: { curso: academic.curso || null, nivel: academic.nivel || null, step: academic.step || null, salon: academic.salon || null },
    destino: { campaign: people.campaign || null, curso: people.tipoCurso || null, salon: people.salon || null, nivel: people.nivel || null, step: people.step || null },
  };
}

export async function promoteFromWelcome(
  academicId: string,
  actor?: { email?: string; nombre?: string }
) {
  const academic = await queryOne<any>(
    `SELECT "_id", "peopleId", "numeroId", "curso", "nivel", "step", "cambioStepHistory" FROM "ACADEMICA" WHERE "_id" = $1`,
    [academicId]
  );
  if (!academic) throw new NotFoundError('Registro académico', academicId);

  // PEOPLE del beneficiario: por peopleId; fallback por numeroId (BENEFICIARIO).
  let people = academic.peopleId
    ? await queryOne<any>(`SELECT "campaign", "tipoCurso", "salon", "nivel", "step" FROM "PEOPLE" WHERE "_id" = $1`, [academic.peopleId])
    : null;
  if (!people) {
    people = await queryOne<any>(
      `SELECT "campaign", "tipoCurso", "salon", "nivel", "step" FROM "PEOPLE"
       WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
       ORDER BY "_createdDate" DESC NULLS LAST LIMIT 1`,
      [academic.numeroId]
    );
  }
  if (!people) throw new NotFoundError('PEOPLE del beneficiario', academicId);

  const before = `${academic.curso || '—'} / ${academic.nivel || '—'} / ${academic.step || '—'}`;
  const after = `${people.tipoCurso || '—'} / ${people.nivel || '—'} / ${people.step || '—'}`;

  const entry = {
    fecha: new Date().toISOString(),
    accion: 'PROMOCION_WELCOME',
    de: before,
    a: after,
    realizadoPor: actor?.nombre || actor?.email || 'Sistema',
  };
  const history = Array.isArray(academic.cambioStepHistory) ? academic.cambioStepHistory : [];

  await query(
    `UPDATE "ACADEMICA"
       SET "campaign" = $2, "curso" = $3, "salon" = $4, "nivel" = $5, "step" = $6,
           "cambioStepHistory" = $7::jsonb, "_updatedDate" = NOW()
     WHERE "_id" = $1`,
    [
      academicId,
      people.campaign || null,
      people.tipoCurso || null,
      people.salon || null,
      people.nivel || '',
      people.step || '',
      JSON.stringify([...history, entry]),
    ]
  );

  return { promoted: true, before, after };
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
 *
 * Persists `suspenddata` (last suspension event) and increments
 * `suspendcount` (only on INACTIVACION). Requires `motivo` and the
 * authenticated user info (`realizadoPor`) so the suspension is
 * auditable. Both fields are mandatory at the API layer.
 *
 * Returns `statusChanged: false` if the requested state matches current.
 */
interface ToggleStatusOptions {
  motivo: string;
  realizadoPor: string;        // email of the admin executing the action
  realizadoPorNombre?: string; // optional display name
}

export async function toggleStatus(id: string, active: boolean, opts: ToggleStatusOptions) {
  const person = await PeopleRepository.findByIdOrThrow(id);

  const currentlyInactive = person.estadoInactivo === true;
  const wantInactive = !active;

  if (currentlyInactive === wantInactive) {
    return { student: person, statusChanged: false };
  }

  const suspendData = {
    accion: (wantInactive ? 'INACTIVACION' : 'REACTIVACION') as 'INACTIVACION' | 'REACTIVACION',
    motivo: opts.motivo,
    fecha: new Date().toISOString(),
    realizadoPor: opts.realizadoPor,
    realizadoPorNombre: opts.realizadoPorNombre,
  };

  // Persist toggle + suspenddata + (conditionally) increment suspendcount.
  // suspendcount only grows on INACTIVACION; REACTIVACION leaves it intact.
  const updated = await PeopleRepository.toggleStatusWithSuspendData(id, wantInactive, suspendData);

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
    suspenddata: suspendData,
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
  return c.asistio === true || c.asistencia === true;
}

/**
 * Strict approval rule for a Jump booking (Step 5, 10, 15, ...):
 *   asistencia=true AND participacion=true AND noAprobo!==true AND not cancelled.
 * The student stays in the jump step until ANY one booking meets all four.
 * Past failed attempts (noAprobo=true on previous bookings) do NOT block a
 * later successful attempt.
 */
function aproboElJump(c: any): boolean {
  const asistio = c.asistio === true || c.asistencia === true;
  return asistio
      && c.participacion === true
      && c.noAprobo !== true
      && c.cancelo !== true;
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
     LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
       AND COALESCE(c."nivel", b."nivel") = $2
       AND (b."cancelo" IS NULL OR b."cancelo" = false)`,
    [studentId, nivel]
  );

  const clasesDelStep = allNivelClasses.filter(
    (c: any) => extractStepNum(c.step) === stepNum
  );

  if (esJump) {
    // Jump completed when ANY booking has: asistencia=true AND participacion=true
    // AND noAprobo!==true AND not cancelled. Previous failed attempts don't block
    // a later successful one.
    return clasesDelStep.some((c: any) => aproboElJump(c));
  }

  const tieneNoAprobo = clasesDelStep.some((c: any) => c.noAprobo === true);
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

  // ─── SPECIAL NIVELES (MASTER, IELS, B2FIRST, TOEFL) ─────────────────────
  // Dispatch to dedicated service when student is in one of these end-of-program
  // niveles. Each promote* function has its own conditions; default returns null
  // so students stay in place until business rules are defined.
  const { isSpecialNivel, autoAdvanceSpecialNivel } = await import('@/services/special-nivel.service');
  if (isSpecialNivel(student.nivel)) {
    return autoAdvanceSpecialNivel(student, booking);
  }

  // Sólo avanzamos dentro del MISMO nivel — esta guarda nunca se relaja.
  if (student.nivel !== bookingNivel) return null;

  // Para steps NORMALES (1-4, 6-9, 11-14, etc.): el booking debe ser del MISMO
  // step del estudiante (por NÚMERO, no por string). El bookingStep puede venir
  // como "Step N" (SESSION) o "TRAINING - Step N" / "GRAMMAR - Step N" / etc.
  // (CLUB), y student.step siempre es "Step N" puro. Comparar por número resuelve
  // el desfase de prefijo: una TRAINING - Step N atendida por un estudiante que
  // está en Step N completa el step (si junto con sus 2 sesiones cumple la regla)
  // y debe disparar el avance — el bug anterior, `student.step !== bookingStep`
  // como strings, bloqueaba este caso y regeneraba "pegados" cada día (mayo 2026).
  //
  // Para JUMPS (5, 10, 15, 20, 25, 30, 35, 40, 45): se relaja la guarda incluso
  // por número, para destrabar estudiantes que aprobaron el Jump fuera de orden
  // (Opción B). La validación dura de aprobación sigue en aproboElJump() dentro
  // de isCurrentStepComplete() más abajo, así que un Jump no aprobado jamás
  // avanza aunque pase esta guarda.
  const esJumpDelBooking = isJumpStep(bookingStep);
  if (!esJumpDelBooking) {
    const sNum = extractStepNum(student.step);
    const bNum = extractStepNum(bookingStep);
    if (sNum === null || bNum === null || sNum !== bNum) return null;
  }

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

  // ─── F3 Step 45 (Jump) approved → route to MASTER/IELTS/B2FIRST/TOEFL ───
  // After passing F3 Jump, the student is promoted to one of 4 special niveles
  // based on ACADEMICA.pruebainter selection. fechaPromocionEspecial is stored
  // for audit only (the 100-day timer was removed in May 2026).
  //
  // If finalContrato is ALREADY expired at this point (student approved the
  // Jump after contract expiry), the rule from special-nivel.service applies
  // post-promotion:
  //   - MASTER (no test selected) → DONE Step 50 + full block
  //   - IELTS/B2FIRST/TOEFL → stay in 47/48/49 + block (preserves test info)
  if (extractStepNum(bookingStep) === 45 && student.nivel === 'F3') {
    const {
      resolvePruebaInterTarget,
      autoAdvanceSpecialNivel,
    } = await import('@/services/special-nivel.service');
    const target = resolvePruebaInterTarget((student as any).pruebainter);
    await ensureFechaPromocionEspecial();
    if (student._id) {
      await query(
        `UPDATE "ACADEMICA"
         SET "fechaPromocionEspecial" = NOW(), "_updatedDate" = NOW()
         WHERE "_id" = $1`,
        [student._id]
      ).catch(err => console.warn('[autoAdvanceStep] fechaPromocionEspecial write failed:', err.message));
    }
    await changeStep(studentId, target.step);

    // Post-promotion: if the contract is already expired, apply the
    // special-nivel rule immediately so the student is left in the right
    // final state (blocked, with or without a Step 50 jump).
    const studentForCheck = {
      _id:        student._id,
      numeroId:   student.numeroId,
      email:      (student as any).email,
      nivel:      target.nivel,
      step:       target.step,
      finalContrato: (student as any).finalContrato,
    };
    const blockResult = await autoAdvanceSpecialNivel(studentForCheck, null);
    if (blockResult?.graduated) {
      return {
        advanced: true,
        from: { nivel: 'F3', step: 'Step 45' },
        to:   blockResult.to ?? { nivel: target.nivel, step: target.step },
        message: blockResult.message,
      };
    }

    return {
      advanced: true,
      from: { nivel: 'F3', step: 'Step 45' },
      to:   { nivel: target.nivel, step: target.step },
    };
  }

  // Use getEffectiveStepNumber to find the real target step.
  // Handles cascading: if Steps 1-4 are all complete, advances directly to Step 5 (Jump).
  // If all nivel steps are complete (returns 0), falls back to next sequential step (level transition).
  const { getEffectiveStepNumber } = await import('@/services/student-booking.service');
  const effectiveStepNum = await getEffectiveStepNumber(studentId, student.nivel);

  // Anti-retroceso: si el cálculo arroja un step MENOR que el actual del
  // estudiante, significa que faltan bookings (típico tras Clear Historic).
  // En ese caso NO retroceder — preservar student.step y abortar el avance.
  const currentStepNumForGuard = extractStepNum(student.step) ?? 0;
  if (effectiveStepNum > 0 && effectiveStepNum < currentStepNumForGuard) return null;

  const targetStepName = effectiveStepNum > 0
    ? `Step ${effectiveStepNum}`
    : `Step ${extractStepNum(bookingStep)! + 1}`; // all nivel steps done → advance to next level

  const { NivelesRepository } = await import('@/repositories/niveles.repository');
  const nextNivelInfo = await NivelesRepository.findByStepName(targetStepName);
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

  await changeStep(studentId, targetStepName);

  return {
    advanced: true,
    from: { nivel: bookingNivel, step: bookingStep },
    to: { nivel: nextNivelInfo.code, step: targetStepName },
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

  // ─── Block user when target is Step 50 (DONE) ───
  // Catches both auto-promotion to DONE AND manual admin promotion via "Cambiar Step".
  // Ensures consistent inactivation in ACADEMICA + PEOPLE + USUARIOS_ROLES.
  if (newStep === 'Step 50' && nivel === 'DONE') {
    const studentForBlock = {
      _id: academic?._id ?? (person as any)?._id,
      numeroId: numeroId,
      email: (academic as any)?.email ?? (person as any)?.email,
      nivel,
      step: newStep,
    };
    const { promoteToDoneAndBlock } = await import('@/services/special-nivel.service');
    await promoteToDoneAndBlock(studentForBlock, 'manual promotion to Step 50').catch(err =>
      console.warn('[changeStep] promoteToDoneAndBlock failed:', err.message)
    );
  }

  return {
    student: updatedPerson || academic,
    isParallel,
    updatedFields: fieldNames,
  };
}

/**
 * GET preflight for Inicializar Nivel:
 * Returns eligibility status, first step of current nivel, and booking count to delete.
 */
// Reiniciar Nivel está deshabilitado para niveles de inicio (ESS/WELCOME),
// nivel final (DONE) y los 4 niveles especiales post-F3 (MASTER, IELS,
// B2FIRST, TOEFL) cuyas condiciones de promoción son específicas y no
// deben sobrescribirse con un reinicio.
const NIVELES_NO_PERMITIDOS = ['ESS', 'WELCOME', 'DONE', 'MASTER', 'IELTS', 'B2FIRST', 'TOEFL'];

export async function getInicializarNivelInfo(academicaId: string) {
  const academic = await AcademicaRepository.findByAnyIdOrThrow(academicaId);
  const { done, data } = await AcademicaRepository.getInicializarNivelStatus(academicaId);

  const nivel = academic.nivel;
  if (!nivel) throw new ValidationError('El estudiante no tiene nivel asignado');

  // Niveles no permitidos
  const nivelBloqueado = NIVELES_NO_PERMITIDOS.includes(nivel?.toUpperCase() || '');

  // Get first step of current nivel from NIVELES (lowest numeric step)
  const firstStepRow = await queryOne<{ step: string }>(
    `SELECT "step" FROM "NIVELES"
     WHERE "code" = $1 AND "step" IS NOT NULL AND "step" != 'WELCOME' AND "step" != 'Step 0'
     ORDER BY CAST(NULLIF(REGEXP_REPLACE("step", '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST
     LIMIT 1`,
    [nivel]
  );
  const firstStep = firstStepRow?.step || null;

  const bookingCount = nivelBloqueado ? 0 : await BookingRepository.countByNivelAndStudent(academicaId, nivel);

  return {
    done,
    nivelBloqueado,
    auditData: done ? data?.inicianivel : null,
    nivel,
    stepActual: academic.step,
    firstStep,
    bookingCount,
  };
}

/**
 * Execute Inicializar Nivel:
 * 1. Deletes all bookings for current nivel
 * 2. Resets step to firstStep in ACADEMICA + PEOPLE
 * 3. Writes audit record
 */
export async function inicializarNivel(
  academicaId: string,
  motivo: string,
  autorizadoPor: string,
  realizadoPor: string
) {
  const { done, nivelBloqueado, nivel, stepActual, firstStep, bookingCount } = await getInicializarNivelInfo(academicaId);

  if (nivelBloqueado) throw new ValidationError(`El proceso Inicializar Nivel no está disponible para el nivel ${nivel}`);
  if (done) throw new ValidationError('Este proceso solo puede realizarse una vez por estudiante');
  if (!firstStep) throw new ValidationError(`No se encontró el primer step del nivel ${nivel}`);

  const academic = await AcademicaRepository.findByAnyIdOrThrow(academicaId);
  const ahora = new Date().toISOString();

  const auditData = {
    fecha: ahora,
    motivo,
    autorizadoPor,
    realizadoPor,
    nivel,
    stepAnterior: stepActual,
    stepNuevo: firstStep,
    bookingsEliminados: bookingCount,
  };

  // 1. Delete bookings for current nivel
  const deleted = await BookingRepository.deleteByNivelAndStudent(academicaId, nivel);

  // 2. Reset step in ACADEMICA + write audit
  await AcademicaRepository.resetNivel(academicaId, firstStep, auditData);

  // 3. Sync PEOPLE (by numeroId, prefer BENEFICIARIO)
  if (academic.numeroId) {
    await queryOne(
      `UPDATE "PEOPLE" SET "step" = $1, "_updatedDate" = NOW()
       WHERE "numeroId" = $2
       ORDER BY CASE WHEN "tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
       LIMIT 1`,
      [firstStep, academic.numeroId]
    ).catch(() => null);
    // PostgreSQL doesn't support ORDER BY on UPDATE directly — use subquery
    await query(
      `UPDATE "PEOPLE" SET "step" = $1, "_updatedDate" = NOW()
       WHERE "_id" = (
         SELECT "_id" FROM "PEOPLE"
         WHERE "numeroId" = $2
         ORDER BY CASE WHEN "tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
         LIMIT 1
       )`,
      [firstStep, academic.numeroId]
    );

    // 4. Agregar comentario a PEOPLE.comentarios (Académico → General)
    const person = await PeopleRepository.findBeneficiarioByNumeroId(academic.numeroId).catch(() => null);
    if (person) {
      const commentObj = {
        id: `comment_${Date.now()}`,
        texto: `[Reiniciar Nivel] ${nivel}, ${stepActual} → ${firstStep}. ${motivo}. Autorizado por: ${autorizadoPor}`,
        usuario: realizadoPor,
        fecha: ahora,
        areaRemitente: 'Académico',
        areaDestinatario: 'General',
      };
      await PeopleRepository.appendComment(person._id, JSON.stringify(commentObj)).catch(() => null);
    }
  }

  return { nivel, stepAnterior: stepActual, stepNuevo: firstStep, bookingsEliminados: deleted, auditData };
}
