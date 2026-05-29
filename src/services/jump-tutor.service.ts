/**
 * Jump Tutor Service
 *
 * Business logic for the Realtime voice tutor that runs the oral Jump exam.
 *
 * A "Jump" evaluates a WHOLE level (e.g. BN1 = Steps 1..5). The bot conducts a
 * short spoken English evaluation personalized with the student's context
 * (hobbies, age, country) over the aggregated content of every step of the
 * level, then calls a single tool — `submitJumpEvaluation` — with a report
 * (score + criteria + strengths/weaknesses + recommendation).
 *
 * The bot does NOT approve the Jump. The report is saved as PENDIENTE; a human
 * advisor/admin reviews it and, on approval, the real Jump booking is created +
 * `autoAdvanceStep` runs (strict jump rule). See `reviewJumpEvaluation`.
 *
 * Design (per agent-architecture): ONE Realtime agent, a short system prompt
 * with only always-needed instructions, dynamic context injected at runtime,
 * a SINGLE tool, no MCP.
 */

import 'server-only';
import { queryOne } from '@/lib/postgres';
import { NivelesRepository } from '@/repositories/niveles.repository';
import { JumpEvaluationRepository } from '@/repositories/jump-evaluation.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { createRealtimeClientSecret } from '@/lib/realtime-session';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { autoAdvanceStep } from '@/services/student.service';

const MAX_ATTEMPTS = 3;

// Niveles excluded from the Jump tutor (no jump exam applies).
const EXCLUDED_NIVELES = new Set(['WELCOME', 'ESS', 'DONE', 'MASTER', 'IELTS', 'B2FIRST', 'TOEFL']);

// ── Helpers ──

function extractStepNumber(stepName?: string | null): number | null {
  const match = stepName?.match(/Step\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function isJumpStep(stepName?: string | null): boolean {
  const n = extractStepNumber(stepName);
  return n !== null && n > 0 && n % 5 === 0;
}

function ageFromBirthdate(fechaNacimiento?: string | null): number | null {
  if (!fechaNacimiento) return null;
  const d = new Date(fechaNacimiento);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  return age > 0 && age < 120 ? age : null;
}

// ── The single tool the Realtime agent can call ──

export const JUMP_EVALUATION_TOOL = {
  type: 'function',
  name: 'submitJumpEvaluation',
  description:
    'Llamar UNA sola vez al finalizar la evaluación oral del Jump, con el reporte completo del desempeño del estudiante. No revela el veredicto al estudiante.',
  parameters: {
    type: 'object',
    properties: {
      score: { type: 'number', description: 'Puntaje global 0-100 del desempeño oral en el nivel' },
      recomendacion: {
        type: 'string',
        enum: ['APROBAR', 'REPROBAR', 'REVISAR'],
        description: 'Recomendación del bot (la aprobación final la decide un humano)',
      },
      criterios: {
        type: 'object',
        description: 'Puntaje 0-100 por criterio',
        properties: {
          pronunciacion: { type: 'number' },
          fluidez: { type: 'number' },
          gramatica: { type: 'number' },
          vocabulario: { type: 'number' },
          comprension: { type: 'number' },
        },
        required: ['pronunciacion', 'fluidez', 'gramatica', 'vocabulario', 'comprension'],
      },
      fortalezas: { type: 'array', items: { type: 'string' }, description: 'Fortalezas observadas (en español)' },
      debilidades: { type: 'array', items: { type: 'string' }, description: 'Aspectos a mejorar (en español)' },
      resumen: { type: 'string', description: 'Resumen para el advisor (en español), 2-4 frases' },
    },
    required: ['score', 'recomendacion', 'criterios', 'fortalezas', 'debilidades', 'resumen'],
  },
} as const;

// ── Eligibility ──

export interface JumpEligibility {
  eligible: boolean;
  reason?: string;
  nivel: string | null;
  jumpStep: string | null;
  attemptsUsed: number;
  maxAttempts: number;
}

export async function checkJumpEligibility(student: any): Promise<JumpEligibility> {
  const nivel: string | null = student?.nivel ?? null;
  // The Jump exam targets the jump step of the student's current level. We use
  // effectiveStep (first incomplete step) so the student is offered the exam
  // exactly when they reach the jump.
  const candidateStep: string | null = student?.effectiveStep ?? student?.step ?? null;
  const base: JumpEligibility = {
    eligible: false,
    nivel,
    jumpStep: null,
    attemptsUsed: 0,
    maxAttempts: MAX_ATTEMPTS,
  };

  if (!nivel) return { ...base, reason: 'Sin nivel asignado' };
  if (EXCLUDED_NIVELES.has(nivel)) return { ...base, reason: `El nivel ${nivel} no tiene examen Jump` };
  if (student?.estadoInactivo) return { ...base, reason: 'Estudiante inactivo' };
  if (!isJumpStep(candidateStep)) {
    return { ...base, reason: 'Aún no llegas al Jump de este nivel' };
  }

  const jumpStep = `Step ${extractStepNumber(candidateStep)}`;
  const studentId = student?.academicaId || student?._id;
  const attemptsUsed = await JumpEvaluationRepository.countByStudentAndNivel(studentId, nivel);
  if (attemptsUsed >= MAX_ATTEMPTS) {
    return { ...base, jumpStep, attemptsUsed, reason: 'Agotaste los intentos del examen Jump' };
  }

  return { eligible: true, nivel, jumpStep, attemptsUsed, maxAttempts: MAX_ATTEMPTS };
}

// ── Context + instructions ──

interface JumpContext {
  primerNombre: string;
  edad: number | null;
  pais: string | null;
  hobbies: string | null;
  detalles: string | null;
  nivel: string;
  jumpStep: string;
  steps: Array<{ step: string; description: string | null; contenido: string | null }>;
}

async function buildJumpContext(student: any, nivel: string, jumpStep: string): Promise<JumpContext> {
  const studentId = student?.academicaId || student?._id;

  // hobbies / detallesPersonales live in ACADEMICA — fetch directly to be safe.
  let hobbies: string | null = student?.hobbies ?? null;
  let detalles: string | null = student?.detallesPersonales ?? null;
  let edad: number | null = student?.edad ?? null;
  let fechaNacimiento: string | null = student?.fechaNacimiento ?? null;

  if (studentId && (!hobbies || !detalles || !edad)) {
    const acad = await queryOne<{ hobbies: string | null; detallesPersonales: string | null; edad: number | null; fechaNacimiento: string | null }>(
      `SELECT "hobbies", "detallesPersonales", "edad", "fechaNacimiento" FROM "ACADEMICA" WHERE "_id" = $1 LIMIT 1`,
      [studentId]
    );
    if (acad) {
      hobbies = hobbies || acad.hobbies;
      detalles = detalles || acad.detallesPersonales;
      edad = edad || acad.edad;
      fechaNacimiento = fechaNacimiento || acad.fechaNacimiento;
    }
  }

  const steps = await NivelesRepository.findStepsContenidoByNivel(nivel);

  return {
    primerNombre: (student?.primerNombre || '').trim() || 'el estudiante',
    edad: edad ?? ageFromBirthdate(fechaNacimiento),
    pais: student?.plataforma ?? null,
    hobbies: hobbies || null,
    detalles: detalles || null,
    nivel,
    jumpStep,
    steps,
  };
}

/**
 * Short system prompt (always-needed) + dynamic context block.
 * Kept compact on purpose — per agent-architecture, only what the agent needs
 * every run goes here; everything situational is the injected context.
 */
function buildRealtimeInstructions(ctx: JumpContext): string {
  // Slice PER STEP (not the whole blob) so every step of the level is
  // represented in the exam context — a Jump evaluates the entire level.
  // ~10k total budget split across steps keeps latency/cost reasonable.
  const PER_STEP = ctx.steps.length > 0 ? Math.floor(10000 / ctx.steps.length) : 2000;
  const contenido = ctx.steps
    .map((s) => {
      const head = `### ${s.step}${s.description ? ` — ${s.description}` : ''}`;
      const body = (s.contenido || '(sin contenido registrado)').trim().slice(0, PER_STEP);
      return `${head}\n${body}`;
    })
    .join('\n\n');

  const ageStr = ctx.edad ? `${ctx.edad} años` : 'desconocida';

  return `Eres el tutor virtual de "Let's Go Speak". Conduces el examen oral JUMP del nivel ${ctx.nivel}: una evaluación hablada, breve y amable, que cubre TODO el nivel (todos sus steps), no una sola lección.

IDIOMA:
- El SALUDO y las INSTRUCCIONES van en ESPAÑOL.
- La EVALUACIÓN (las preguntas y la conversación de prueba) va en INGLÉS — es un examen de inglés.
- Si el estudiante se traba, puedes dar una pista corta en español, pero retoma el inglés enseguida.

REGLAS:
- Haz UNA pregunta a la vez y espera la respuesta. Nunca preguntes más de una cosa a la vez.
- Adapta la dificultad a las respuestas. El examen dura entre 5 y 8 minutos.
- Sé cálido y motivador; es una evaluación, no un interrogatorio.
- NUNCA le digas al estudiante si aprobó o no — un humano revisa el resultado. Al final solo agradece.

FLUJO:
1. Saluda EXACTAMENTE así, en español: "¡Hola ${ctx.primerNombre}! Soy el tutor virtual de Let's Go Speak. Vamos a realizar una evaluación de tu Jump del nivel ${ctx.nivel}."
2. Da las instrucciones en español: explica que vas a conversar con él/ella EN INGLÉS sobre los temas del nivel, que responda con naturalidad, que durará unos 5–8 minutos, que harás una pregunta a la vez, y que al terminar un asesor revisará su resultado.
3. Pregúntale si está listo/a para comenzar. Cuando confirme, CAMBIA A INGLÉS.
4. Warm-up breve en inglés usando sus hobbies/intereses.
5. Evalúa el speaking sobre el contenido del nivel (abajo): que use la gramática, el vocabulario y los temas objetivo en oraciones reales. Profundiza con preguntas de seguimiento. Cubre varios steps del nivel, no solo uno.
6. Cuando tengas evidencia suficiente (≈5–8 min), despídete con calidez (puedes cerrar en español) y luego llama la herramienta "submitJumpEvaluation" exactamente UNA vez con el reporte completo. Los puntajes son 0–100. Escribe fortalezas/debilidades/resumen en ESPAÑOL (para el asesor). No anuncies el veredicto al estudiante.

STUDENT CONTEXT:
- Name: ${ctx.primerNombre}
- Age: ${ageStr}
- Country/platform: ${ctx.pais || 'desconocido'}
- Hobbies/interests: ${ctx.hobbies || 'no registrados'}
- Personal details: ${ctx.detalles || 'no registrados'}

LEVEL ${ctx.nivel} CONTENT TO EVALUATE (all steps):
${contenido}`;
}

// ── Start a session (called by /session route) ──

export async function startJumpSession(student: any): Promise<{
  evaluationId: string;
  clientSecret: string;
  model: string;
  voice: string;
  instructions: string;
  tools: any[];
  nivel: string;
  jumpStep: string;
}> {
  const elig = await checkJumpEligibility(student);
  if (!elig.eligible || !elig.nivel || !elig.jumpStep) {
    throw new ValidationError(elig.reason || 'No eres elegible para el examen Jump');
  }

  const ctx = await buildJumpContext(student, elig.nivel, elig.jumpStep);
  const instructions = buildRealtimeInstructions(ctx);

  const studentId = student?.academicaId || student?._id;
  const evaluationId = generateEvaluationId();
  await JumpEvaluationRepository.createInProgress({
    _id: evaluationId,
    studentId,
    numeroId: student?.numeroId ?? null,
    nivel: elig.nivel,
    jumpStep: elig.jumpStep,
    plataforma: student?.plataforma ?? null,
  });

  const secret = await createRealtimeClientSecret();

  return {
    evaluationId,
    clientSecret: secret.value,
    model: secret.model,
    voice: secret.voice,
    instructions,
    tools: [JUMP_EVALUATION_TOOL],
    nivel: elig.nivel,
    jumpStep: elig.jumpStep,
  };
}

function generateEvaluationId(): string {
  // jump-specific prefix; reuses the shared timestamp+random scheme.
  return `jev_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ── Save the bot's report (called by /report route, the tool backend) ──

export async function saveJumpReport(
  evaluationId: string,
  student: any,
  report: {
    score: number;
    recomendacion: 'APROBAR' | 'REPROBAR' | 'REVISAR';
    criterios?: Record<string, number> | null;
    fortalezas?: string[] | null;
    debilidades?: string[] | null;
    resumen?: string | null;
    transcript?: any[] | null;
    durationSec?: number | null;
  }
): Promise<{ ok: true }> {
  const evaluation = await JumpEvaluationRepository.findById(evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluación Jump', evaluationId);

  const studentId = student?.academicaId || student?._id;
  if (evaluation.studentId !== studentId) {
    throw new ValidationError('Esta evaluación no te pertenece');
  }
  if (evaluation.status === 'COMPLETED') {
    throw new ConflictError('Esta evaluación ya fue registrada');
  }

  if (typeof report.score !== 'number' || !report.recomendacion) {
    throw new ValidationError('Reporte incompleto: score y recomendacion son requeridos');
  }

  await JumpEvaluationRepository.saveReport(evaluationId, {
    score: Math.max(0, Math.min(100, report.score)),
    recomendacion: report.recomendacion,
    criterios: report.criterios ?? null,
    fortalezas: report.fortalezas ?? null,
    debilidades: report.debilidades ?? null,
    resumen: report.resumen ?? null,
    transcript: report.transcript ?? null,
    durationSec: report.durationSec ?? null,
  });

  return { ok: true };
}

// ── Admin review (human approval) ──

export async function listJumpEvaluations(opts: { reviewStatus?: string; nivel?: string } = {}) {
  return JumpEvaluationRepository.findForReview(opts);
}

/**
 * Human decision on a bot report.
 * - APROBADO → creates the real Jump booking (asistio+participacion, strict
 *   jump rule satisfied) and triggers autoAdvanceStep so the student advances.
 * - RECHAZADO → records the decision; the student may retake/reschedule.
 */
export async function reviewJumpEvaluation(
  evaluationId: string,
  decision: 'APROBADO' | 'RECHAZADO',
  reviewedBy: string,
  nota?: string | null
): Promise<{ ok: true; bookingId?: string; advancement?: any }> {
  const evaluation = await JumpEvaluationRepository.findById(evaluationId);
  if (!evaluation) throw new NotFoundError('Evaluación Jump', evaluationId);
  if (evaluation.status !== 'COMPLETED') {
    throw new ConflictError('La evaluación aún no tiene reporte');
  }
  if (evaluation.reviewStatus !== 'PENDIENTE') {
    throw new ConflictError('Esta evaluación ya fue revisada');
  }

  await JumpEvaluationRepository.setReview(evaluationId, decision, reviewedBy, nota);

  if (decision !== 'APROBADO') {
    return { ok: true };
  }

  // Create the Jump booking that satisfies the strict jump approval rule.
  const bookingId = ids.booking();
  const today = new Date();
  await BookingRepository.createEnrollment({
    _id: bookingId,
    eventoId: `jump_${evaluationId}`,
    idEvento: `jump_${evaluationId}`,
    studentId: evaluation.studentId,
    idEstudiante: evaluation.studentId,
    nivel: evaluation.nivel,
    step: evaluation.jumpStep,
    tipo: 'SESSION',
    tipoEvento: 'SESSION',
    asistio: true,
    asistencia: true,
    participacion: true,
    noAprobo: false,
    cancelo: false,
    fecha: today.toISOString().split('T')[0],
    fechaEvento: today.toISOString().split('T')[0],
    hora: today.toTimeString().slice(0, 5),
    advisor: 'BOT_TUTOR',
    nombreEvento: `Jump ${evaluation.nivel} (Bot Tutor) - ${evaluation.jumpStep}`,
    tituloONivel: evaluation.nivel,
    agendadoPor: reviewedBy,
    agendadoPorRol: 'REVISOR',
    origen: 'JUMP_BOT',
    fechaAgendamiento: today.toISOString(),
  });

  let advancement: any = null;
  try {
    advancement = await autoAdvanceStep(bookingId);
  } catch {
    // Advance failure shouldn't block the approval result.
  }

  return { ok: true, bookingId, advancement };
}
