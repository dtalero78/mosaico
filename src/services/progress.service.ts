/**
 * Progress Service
 *
 * Business logic for the "¿Cómo voy?" student progress report.
 * Calculates step completion, attendance stats, and class breakdown.
 *
 * Step completion rules:
 *   1. Normal Steps (1-4, 6-9, 11-14, etc.):
 *      - 2 sesiones exitosas (tipo SESSION, asistio/asistencia = true)
 *      - 1 TRAINING club exitoso (tipo CLUB, asistio/asistencia = true)
 *      - participacion solo cuenta como exitosa en JUMP steps (múltiplos de 5)
 *   2. Jump Steps (5, 10, 15, 20, 25, 30, 35, 40, 45):
 *      - 1 clase registrada en ese step
 *      - noAprobo !== true
 *   3. Overrides manuales tienen prioridad absoluta sobre toda la lógica.
 */

import 'server-only';
import { queryMany } from '@/lib/postgres';
import { PeopleRepository } from '@/repositories/people.repository';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { StepOverridesRepository } from '@/repositories/niveles.repository';
import { NotFoundError } from '@/lib/errors';

// --- Helpers ---

/** Extract club type prefix from a step name: "TRAINING - Step 7" → "TRAINING", "Step 7" → null */
function extractClubName(stepStr: string): string | null {
  const match = stepStr?.match(/^(.+?)\s*-\s*Step\s*\d+/i);
  return match ? match[1].trim() : null;
}

/** Extract the numeric part from a step name: "Step 7" → 7, "TRAINING - Step 7" → 7 */
function extractStepNumber(stepName: string): number | null {
  const match = stepName.match(/Step\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

/** Jump Steps are multiples of 5: Step 5, 10, 15, 20, 25, 30, 35, 40, 45 */
function isJumpStep(stepName: string): boolean {
  const num = extractStepNumber(stepName);
  return num !== null && num > 0 && num % 5 === 0;
}

/**
 * A class counts as "exitosa" (used for NORMAL step counting) if the student attended.
 * Jumps have their own stricter approval rule — see `aproboElJump`.
 */
function isExitosa(c: any): boolean {
  return c.asistio === true || c.asistencia === true;
}

/**
 * Strict approval rule for a Jump booking (Step 5, 10, 15, ...):
 *   asistencia=true AND participacion=true AND noAprobo!==true AND not cancelled.
 * The student stays in the jump step until ANY one booking meets all four.
 */
function aproboElJump(c: any): boolean {
  const asistio = c.asistio === true || c.asistencia === true;
  return asistio
      && c.participacion === true
      && c.noAprobo !== true
      && c.cancelo !== true;
}

/**
 * Determine the effective class type.
 * The `tipo` column is null in migrated Wix data, so we infer from the step name:
 *   - "Step N"            → SESSION
 *   - "TRAINING - Step N" → CLUB
 *   - Other prefixes      → OTHER (not counted toward step requirements)
 * When `tipo` is populated (e.g. events created via admin panel), use it directly.
 */
function getClassType(c: any): 'SESSION' | 'CLUB' | 'OTHER' {
  if (c.tipo === 'SESSION' || c.tipo === 'COMPLEMENTARIA') return 'SESSION';
  if (c.tipo === 'CLUB') return 'CLUB';
  if (c.tipo === 'WELCOME') return 'OTHER';
  // Infer from step name when tipo is null
  if (!c.tipo && c.step) {
    if (/^TRAINING\s*-/i.test(c.step)) return 'CLUB';
    if (/^Step\s+\d+$/i.test(c.step)) return 'SESSION';
  }
  return 'OTHER';
}

// A TRAINING club is a CLUB whose step/event name starts with "TRAINING -"
function isTrainingClub(c: any): boolean {
  if (getClassType(c) !== 'CLUB') return false;
  const name = c.step || c.nombreEvento || '';
  return /^TRAINING\s*-/i.test(name);
}

// --- Main ---

/**
 * Generate the full progress report for a student.
 */
export async function generateReport(studentId: string) {
  // Get student info — ACADEMICA is source of truth for nivel/step
  let student: any = await PeopleRepository.findByIdOrNumeroId(studentId);
  let overrideStudentId: string;

  if (!student) {
    student = await AcademicaRepository.findByAnyId(studentId);
    if (!student) throw new NotFoundError('Student', studentId);
    // STEP_OVERRIDES uses ACADEMICA _id
    overrideStudentId = student._id;
  } else {
    // ACADEMICA is the source of truth for nivel/step (PEOPLE may be stale from Wix migration)
    const academica = student.numeroId
      ? await AcademicaRepository.findByAnyId(student.numeroId)
      : null;
    if (academica) {
      student.nivel = academica.nivel ?? student.nivel;
      student.step = academica.step ?? student.step;
      student.nivelParalelo = academica.nivelParalelo ?? student.nivelParalelo;
      student.stepParalelo = academica.stepParalelo ?? student.stepParalelo;
      // Use ACADEMICA _id for booking queries and STEP_OVERRIDES
      student._id = academica._id;
    }
    overrideStudentId = student._id;
  }

  const nivelPrincipal = student.nivel;

  // Get all classes for this student (exclude future sessions)
  // JOIN with CALENDARIO to get the real step/nivel from the event
  const allClasses = await queryMany(
    `SELECT b."_id", b."eventoId",
            COALESCE(c."nivel", b."nivel") AS "nivel",
            COALESCE(c."step", b."step") AS "step",
            b."advisor", b."fechaEvento", b."hora",
            b."tipo", b."nombreEvento", b."asistio", b."asistencia", b."participacion",
            b."calificacion", b."comentarios", b."noAprobo", b."cancelo"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
     WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
       AND (b."fechaEvento" IS NULL OR b."fechaEvento"::date <= CURRENT_DATE)
     ORDER BY b."fechaEvento" DESC`,
    [student._id]
  );

  // Filter classes for current nivel (exclude ESS and WELCOME from step progress)
  const clasesNivelActual = allClasses.filter(
    (c) => c.nivel === nivelPrincipal && c.step !== 'WELCOME' && c.nivel !== 'ESS'
  );

  // Get all steps for current nivel
  const stepsRows = await queryMany<{ step: string }>(
    `SELECT DISTINCT "step"
     FROM "NIVELES"
     WHERE "code" = $1 AND "step" != 'WELCOME'
     ORDER BY "step"`,
    [nivelPrincipal]
  );
  const allSteps = stepsRows
    .map((r) => r.step)
    .sort((a, b) => (extractStepNumber(a) ?? 0) - (extractStepNumber(b) ?? 0));

  // Get all overrides for this student at once (avoid N+1)
  // Uses ACADEMICA _id — matches how step-override route stores them
  const overrides = await StepOverridesRepository.findByStudentId(overrideStudentId);
  const overrideMap = new Map(
    overrides.map((o: any) => [o.step, o.isCompleted])
  );

  // Calculate progress by step
  const progressByStep = allSteps.map((stepName) => {
    const stepNum = extractStepNumber(stepName);
    const esJump = isJumpStep(stepName);

    // Match classes by step number to handle both "Step 7" and "TRAINING - Step 7"
    const clasesDelStep = clasesNivelActual.filter(
      (c) => extractStepNumber(c.step) === stepNum
    );

    // Separate by type (infer from step name when tipo is null)
    const sesiones = clasesDelStep.filter((c) => getClassType(c) === 'SESSION');
    const clubs = clasesDelStep.filter((c) => getClassType(c) === 'CLUB');
    const sesionesExitosas = sesiones.filter(isExitosa).length;
    const clubsExitosos = clubs.filter(isExitosa).length;
    // Only TRAINING clubs count toward step completion
    const trainingClubsExitosos = clubs.filter((c) => isTrainingClub(c) && isExitosa(c)).length;
    const clubNombres = clubs
      .filter(isExitosa)
      .map((c) => extractClubName(c.step || '') || c.nombreEvento || 'CLUB')
      .filter(Boolean);
    const tieneNoAprobo = clasesDelStep.some((c) => c.noAprobo === true);

    // Override has absolute priority
    const hasOverride = overrideMap.has(stepName);
    const overrideCompletado = hasOverride ? overrideMap.get(stepName) : null;

    let completado: boolean;
    let mensaje: string | null = null;

    if (overrideCompletado === true) {
      completado = true;
    } else if (overrideCompletado === false) {
      completado = false;
      mensaje = 'Marcado como incompleto por administrador';
    } else if (esJump) {
      // Jump approves only when ANY booking satisfies the strict rule:
      // asistencia=true AND participacion=true AND noAprobo!==true AND not cancelled.
      // Previous failed/incomplete attempts do NOT block a later successful one.
      const aprobado = clasesDelStep.some((c) => aproboElJump(c));
      const clasesNoCancel = clasesDelStep.filter((c) => !c.cancelo);
      const todasCanceladas = clasesDelStep.length > 0 && clasesNoCancel.length === 0;
      const algunaAsistio = clasesNoCancel.some((c) => isExitosa(c));
      const algunaConParticipacion = clasesNoCancel.some((c) => c.participacion === true);

      if (aprobado) {
        completado = true;
      } else if (clasesDelStep.length === 0) {
        completado = false;
        mensaje = 'Falta la clase del jump';
      } else if (todasCanceladas) {
        completado = false;
        mensaje = 'Canceló la clase del jump, debe reagendarla';
      } else if (!algunaAsistio) {
        completado = false;
        mensaje = 'Falta asistir al jump';
      } else if (!algunaConParticipacion) {
        completado = false;
        mensaje = 'Falta marcar participación en el jump';
      } else {
        // asistió + participó pero todos los intentos tienen noAprobo=true
        completado = false;
        mensaje = 'No aprobó el jump';
      }
    } else {
      // Normal Step: 2 sesiones exitosas + 1 TRAINING club exitoso
      // OR: 1 sesión exitosa + 1 complementaria aprobada (tipo=COMPLEMENTARIA cuenta como SESSION) + 1 TRAINING club exitoso
      completado = sesionesExitosas >= 2 && trainingClubsExitosos >= 1;

      if (!completado) {
        if (sesionesExitosas >= 2 && trainingClubsExitosos === 0) {
          mensaje = 'Falta el TRAINING club del step';
        } else if (sesionesExitosas === 1 && trainingClubsExitosos === 0) {
          mensaje = 'Falta una sesión y el TRAINING club';
        } else if (sesionesExitosas === 1 && trainingClubsExitosos >= 1) {
          mensaje = 'Falta una sesión para terminar';
        } else if (sesionesExitosas === 0 && trainingClubsExitosos >= 1) {
          mensaje = 'Faltan dos sesiones';
        } else {
          mensaje = 'Faltan dos sesiones y el TRAINING club';
        }
      }
    }

    // Eligible for complementary activity: normal step, not completed, has exactly 1 session
    // BUT not if the student had a successful session THIS WEEK (Mon-Sun) — they can still book another regular session
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    const hadSessionThisWeek = sesiones.filter(isExitosa).some((c) => {
      if (!c.fechaEvento) return false;
      const fecha = new Date(c.fechaEvento);
      return fecha >= startOfWeek;
    });
    const complementariaEligible = !esJump && !completado && sesionesExitosas === 1 && overrideCompletado !== true && !hadSessionThisWeek;

    // Append complementaria hint only when eligible
    if (complementariaEligible && mensaje) {
      mensaje += ' Puedes realizar una actividad complementaria.';
    }

    return {
      step: stepName,
      esJump,
      totalClases: clasesDelStep.length,
      sesiones: sesiones.length,
      sesionesExitosas,
      clubs: clubs.length,
      clubsExitosos,
      trainingClubsExitosos,
      clubNombres,
      noAprobo: tieneNoAprobo,
      completado,
      mensaje,
      hasOverride,
      overrideCompletado,
      complementariaEligible,
    };
  });

  // Overall statistics (across ALL classes including ESS)
  const totalClases = allClasses.length;
  const totalAsistencias = allClasses.filter((c) => isExitosa(c)).length;
  const totalAusencias = allClasses.filter((c) => c.asistio === false).length;
  const totalPendientes = allClasses.filter((c) => c.asistio === null || c.asistio === undefined).length;
  const porcentajeAsistencia =
    totalClases > 0 ? Math.round((totalAsistencias / totalClases) * 100) : 0;

  const stepsCompletados = progressByStep.filter((s) => s.completado).length;
  const porcentajeProgreso =
    allSteps.length > 0 ? Math.round((stepsCompletados / allSteps.length) * 100) : 0;

  // Group classes by tipo
  const byTipoMap: Record<string, { tipo: string; totalClases: number; asistencias: number }> = {};
  for (const c of allClasses) {
    if (!c.tipo) continue;
    if (!byTipoMap[c.tipo]) {
      byTipoMap[c.tipo] = { tipo: c.tipo, totalClases: 0, asistencias: 0 };
    }
    byTipoMap[c.tipo].totalClases++;
    if (isExitosa(c)) byTipoMap[c.tipo].asistencias++;
  }

  return {
    student: {
      _id: student._id,
      numeroId: student.numeroId,
      nombre: `${student.primerNombre} ${student.primerApellido}`,
      nivel: student.nivel,
      step: student.step,
      nivelParalelo: student.nivelParalelo,
      stepParalelo: student.stepParalelo,
      plataforma: student.plataforma,
      email: student.email,
    },
    progress: {
      nivelActual: nivelPrincipal,
      totalSteps: allSteps.length,
      stepsCompletados,
      porcentajeProgreso,
      progressByStep,
    },
    stats: {
      totalClases,
      totalAsistencias,
      totalAusencias,
      totalPendientes,
      porcentajeAsistencia,
    },
    byTipo: Object.values(byTipoMap),
    allClasses: allClasses.map((c) => ({
      _id: c._id,
      nivel: c.nivel,
      step: c.step,
      tipo: c.tipo,
      nombreEvento: c.nombreEvento,
      advisor: c.tipo === 'COMPLEMENTARIA' ? 'PLATAFORMA' : c.advisor,
      fechaEvento: c.fechaEvento,
      hora: c.hora,
      asistio: c.asistio,
      asistencia: c.asistencia,
      participacion: c.participacion,
      calificacion: c.calificacion,
      comentarios: c.comentarios,
      noAprobo: c.noAprobo,
    })),
  };
}
