import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession, getStudentMaterials } from '@/services/panel-estudiante.service';

export const GET = handlerWithAuth(async (request, context, session) => {
  const student = await resolveStudentFromSession(session);
  const nivel = student.nivel || '';
  // Curso del alumno (YOJI, OKINA, …): llave del material interactivo, que en
  // MOSAICO es un libro por curso (el `nivel` es el módulo, no el curso).
  const curso = (student as any).tipoCurso || (student as any).curso || '';
  const materials = await getStudentMaterials(nivel);
  return successResponse({ materials, nivel, curso });
});
