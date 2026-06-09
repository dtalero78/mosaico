/**
 * Complementaria Service
 *
 * Business logic for complementary activities (AI-generated quizzes).
 *
 * Rules:
 * - Student must have exactly 1 successful SESSION for the step (needs 2)
 * - Not available for Jump Steps (multiples of 5)
 * - Max 3 persistent attempts per step
 * - Pass threshold: ≥50%
 * - On pass: creates ACADEMICA_BOOKINGS record (tipo=COMPLEMENTARIA) and triggers auto-promotion
 */

import 'server-only';
import { queryMany } from '@/lib/postgres';
import { ComplementariaRepository } from '@/repositories/complementaria.repository';
import { NivelesRepository } from '@/repositories/niveles.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { ValidationError, ConflictError, NotFoundError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { autoAdvanceStep } from '@/services/student.service';

const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 50;

// ── Helpers ──

function extractStepNumber(stepName: string): number | null {
  const match = stepName?.match(/Step\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function isExitosa(c: any): boolean {
  return c.asistio === true || c.asistencia === true || c.participacion === true;
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

// ── Eligibility ──

export async function checkEligibility(
  studentId: string,
  nivel: string,
  step: string
): Promise<{ eligible: boolean; reason?: string; attemptsUsed: number; maxAttempts: number }> {
  const stepNum = extractStepNumber(step);
  if (stepNum === null) {
    return { eligible: false, reason: 'Step no válido', attemptsUsed: 0, maxAttempts: MAX_ATTEMPTS };
  }

  // Only steps 1–44 (excluding multiples of 5) are eligible
  if (stepNum > 44) {
    return { eligible: false, reason: 'No disponible para steps mayores de 44', attemptsUsed: 0, maxAttempts: MAX_ATTEMPTS };
  }
  if (stepNum > 0 && stepNum % 5 === 0) {
    return { eligible: false, reason: 'No disponible para Jump Steps', attemptsUsed: 0, maxAttempts: MAX_ATTEMPTS };
  }

  const attemptsUsed = await ComplementariaRepository.countAttempts(studentId, nivel, step);
  const alreadyPassed = await ComplementariaRepository.hasPassed(studentId, nivel, step);

  if (alreadyPassed) {
    return { eligible: false, reason: 'Ya aprobaste la actividad complementaria para este step', attemptsUsed, maxAttempts: MAX_ATTEMPTS };
  }
  if (attemptsUsed >= MAX_ATTEMPTS) {
    return { eligible: false, reason: 'Has agotado los 3 intentos permitidos', attemptsUsed, maxAttempts: MAX_ATTEMPTS };
  }

  // Check session count for this step (JOIN CALENDARIO for real step/nivel)
  const classes = await queryMany(
    `SELECT b."tipo", COALESCE(c."step", b."step") AS "step",
            b."asistio", b."asistencia", b."participacion"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
       AND COALESCE(c."nivel", b."nivel") = $2
       AND (b."cancelo" IS NULL OR b."cancelo" = false)`,
    [studentId, nivel]
  );

  const clasesDelStep = classes.filter(
    (c: any) => extractStepNumber(c.step) === stepNum
  );

  const sesionesExitosas = clasesDelStep.filter(
    (c: any) => getClassType(c) === 'SESSION' && isExitosa(c)
  ).length;

  if (sesionesExitosas === 0) {
    return { eligible: false, reason: 'Necesitas al menos 1 sesión exitosa antes de la actividad complementaria', attemptsUsed, maxAttempts: MAX_ATTEMPTS };
  }
  if (sesionesExitosas >= 2) {
    return { eligible: false, reason: 'Ya tienes 2 sesiones exitosas, no necesitas actividad complementaria', attemptsUsed, maxAttempts: MAX_ATTEMPTS };
  }

  return { eligible: true, attemptsUsed, maxAttempts: MAX_ATTEMPTS };
}

// ── Generate Questions ──

export async function generateQuestions(
  studentId: string,
  nivel: string,
  step: string,
  plataforma?: string
): Promise<{ attemptId: string; questions: any[]; attemptNumber: number }> {
  const elig = await checkEligibility(studentId, nivel, step);
  if (!elig.eligible) {
    throw new ValidationError(elig.reason || 'No eres elegible para esta actividad');
  }

  // Resume existing in-progress attempt
  const existing = await ComplementariaRepository.findInProgress(studentId, nivel, step);
  if (existing) {
    return {
      attemptId: existing._id,
      questions: existing.questions,
      attemptNumber: existing.attemptNumber,
    };
  }

  // Fetch step content from NIVELES
  const contenido = await NivelesRepository.findContenidoByNivelAndStep(nivel, step);
  if (!contenido) {
    throw new NotFoundError('Contenido del step', `${nivel} - ${step}`);
  }

  // Generate questions with OpenAI
  const questions = await callOpenAIGenerateQuestions(contenido, nivel, step);

  // Save attempt
  const attemptNumber = elig.attemptsUsed + 1;
  const attemptId = ids.complementaria();

  await ComplementariaRepository.createAttempt({
    _id: attemptId,
    studentId,
    nivel,
    step,
    attemptNumber,
    questions: JSON.stringify(questions),
    status: 'IN_PROGRESS',
    ...(plataforma ? { plataforma } : {}),
  });

  return { attemptId, questions, attemptNumber };
}

// ── Grade Answers ──

export async function gradeAnswers(
  attemptId: string,
  studentId: string,
  answers: any[]
): Promise<{
  score: number;
  passed: boolean;
  results: any[];
  bookingId?: string;
  advancement?: any;
  attemptsRemaining: number;
}> {
  const attempt = await ComplementariaRepository.findById(attemptId);
  if (!attempt) throw new NotFoundError('Intento', attemptId);
  if (attempt.studentId !== studentId) throw new ValidationError('Este intento no te pertenece');
  if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('Este intento ya fue completado');

  // Validate all questions answered
  if (!answers || answers.length !== 10) {
    throw new ValidationError('Debes responder las 10 preguntas');
  }

  // Grade with OpenAI
  const { score, results } = await callOpenAIGradeAnswers(attempt.questions, answers);
  const passed = score >= PASS_THRESHOLD;

  let bookingId: string | undefined;
  let advancement: any = null;

  if (passed) {
    // Create ACADEMICA_BOOKINGS record
    bookingId = ids.booking();
    await BookingRepository.createEnrollment({
      _id: bookingId,
      eventoId: `comp_${attemptId}`,
      idEvento: `comp_${attemptId}`,
      studentId: studentId,
      idEstudiante: studentId,
      nivel: attempt.nivel,
      step: attempt.step,
      tipo: 'COMPLEMENTARIA',
      tipoEvento: 'COMPLEMENTARIA',
      asistio: true,
      asistencia: true,
      participacion: true,
      noAprobo: false,
      cancelo: false,
      fecha: new Date().toISOString().split('T')[0],
      fechaEvento: new Date().toISOString().split('T')[0],
      hora: new Date().toTimeString().slice(0, 5),
      advisor: 'COMPLEMENTARIA',
      nombreEvento: `Actividad Complementaria - ${attempt.step}`,
      tituloONivel: attempt.nivel,
      agendadoPor: 'SISTEMA',
      agendadoPorRol: 'SISTEMA',
      origen: 'COMP',
      fechaAgendamiento: new Date().toISOString(),
    });

    // Auto-advance if step is now complete
    try {
      advancement = await autoAdvanceStep(bookingId);
    } catch {
      // Auto-advance failure shouldn't block the grading result
    }
  }

  // Count remaining attempts
  const totalAttempts = await ComplementariaRepository.countAttempts(
    studentId, attempt.nivel, attempt.step
  );

  // Update attempt record
  await ComplementariaRepository.updateAttempt(attemptId, {
    answers,
    score,
    passed,
    status: passed ? 'PASSED' : 'FAILED',
    bookingId,
  });

  return {
    score,
    passed,
    results,
    bookingId,
    advancement,
    attemptsRemaining: MAX_ATTEMPTS - totalAttempts,
  };
}

// ── OpenAI Helpers ──

async function callOpenAIGenerateQuestions(contenido: string, nivel: string, step: string): Promise<any[]> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an English language teacher creating a quiz for level ${nivel}, ${step}. Generate exactly 10 questions based on the provided lesson content.

Return a JSON object with a "questions" array containing exactly 10 questions in this order:
1-4: Multiple choice (4 options each, exactly 1 correct)
5: True/False
6-7: Open-ended (short answer)
8-9: Multiple choice (4 options each, exactly 1 correct)
10: One additional question (any type from above)

Each question object must have:
- "id": number (1-10)
- "type": "multiple_choice" | "true_false" | "open_ended"
- "question": string (in English)
- "options": string[] (for multiple_choice: 4 options; for true_false: ["True", "False"]; for open_ended: empty array [])
- "correctAnswer": string (the correct option text, "True"/"False", or model answer)
- "explanation": string (brief explanation of why the answer is correct)`
      },
      {
        role: 'user',
        content: `Lesson content:\n\n${contenido.substring(0, 4000)}`
      }
    ],
  });

  const parsed = JSON.parse(response.choices[0].message.content || '{}');
  if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length < 10) {
    throw new Error('OpenAI did not return 10 valid questions');
  }
  return parsed.questions.slice(0, 10);
}

async function callOpenAIGradeAnswers(
  questions: any[],
  answers: any[]
): Promise<{ score: number; results: any[] }> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const qaPairs = questions.map((q: any, i: number) => ({
    questionId: q.id,
    question: q.question,
    type: q.type,
    correctAnswer: q.correctAnswer,
    studentAnswer: typeof answers[i] === 'string' ? answers[i] : (answers[i]?.answer || ''),
  }));

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an English language teacher grading a quiz. Grade each answer strictly but fairly.

For multiple choice and true/false: exact match required.
For open-ended: accept answers that demonstrate understanding, even with minor grammar/spelling mistakes.

Return a JSON object with:
- "results": array of objects, each with:
  - "questionId": number
  - "correct": boolean
  - "feedback": string (brief feedback in Spanish for the student)
- "totalCorrect": number
- "score": number (percentage 0-100, calculated as totalCorrect/totalQuestions * 100)`
      },
      {
        role: 'user',
        content: JSON.stringify(qaPairs)
      }
    ],
  });

  const parsed = JSON.parse(response.choices[0].message.content || '{}');
  return {
    score: parsed.score || 0,
    results: parsed.results || [],
  };
}
