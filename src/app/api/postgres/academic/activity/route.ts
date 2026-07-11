import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { PeopleRepository } from '@/repositories/people.repository';
import { NivelesRepository } from '@/repositories/niveles.repository';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';

/**
 * POST /api/postgres/academic/activity
 *
 * Generate a personalized AI activity suggestion for a student
 * based on their level, step, and recent attendance.
 */
export const POST = handlerWithAuth(async (request) => {
  const body = await request.json();
  const { studentId, nivel } = body;

  if (!studentId) throw new ValidationError('studentId is required');
  if (!nivel) throw new ValidationError('nivel is required');

  const student = await PeopleRepository.findByIdOrNumeroIdOrThrow(studentId);

  // Get recent bookings for context
  const bookings = await queryMany(
    `SELECT "nivel", "step", "nombreEvento", "asistio", "noAprobo", "evaluacion"
     FROM "ACADEMICA_BOOKINGS"
     WHERE ("idEstudiante" = $1 OR "studentId" = $1)
     ORDER BY "fechaEvento" DESC
     LIMIT 15`,
    [student._id]
  );

  const asistencias = bookings.filter((b: any) => b.asistio === true).length;
  const ausencias = bookings.filter((b: any) => b.asistio === false).length;

  // Try to get contenido for the student's current step
  const studentStep = student.step || 'Step 1';
  const studentNivel = student.nivel || nivel;
  const contenido = await NivelesRepository.findContenidoByNivelAndStep(studentNivel, studentStep);

  const studentName = `${student.primerNombre || ''} ${student.primerApellido || ''}`.trim();

  const prompt = `Eres un advisor de la plataforma MOSAICO. Genera una actividad personalizada breve para un estudiante.

Estudiante: ${studentName}
Nivel: ${studentNivel}
Step actual: ${studentStep}
Asistencias recientes: ${asistencias} de ${bookings.length} clases
${contenido ? `\nContenido del step:\n${contenido.slice(0, 2000)}` : ''}

Genera UNA actividad práctica y concreta que el advisor pueda proponer al estudiante durante la clase. La actividad debe:
- Ser apropiada para el nivel del estudiante
- Durar entre 5-10 minutos
- Ser interactiva y comunicativa
- Incluir instrucciones claras para el advisor

Responde SOLO con la actividad, sin preámbulos. Escribe en español. Máximo 200 palabras.`;

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 500,
    temperature: 0.8,
  });

  const activity = completion.choices[0]?.message?.content?.trim() || 'No se pudo generar la actividad.';

  return successResponse({ activity });
});
