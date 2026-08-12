import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession, getStudentMaterials } from '@/services/panel-estudiante.service';

export const GET = handlerWithAuth(async (request, context, session) => {
  const student = await resolveStudentFromSession(session);
  const nivel = student.nivel || '';   // módulo ACTUAL del alumno (para el interactivo)
  // Curso del alumno (YOJI, OKINA, …): llave del material interactivo, que en
  // MOSAICO es un libro por curso (el `nivel` es el módulo, no el curso).
  const curso = (student as any).tipoCurso || (student as any).curso || '';
  // El material descargable (los "libros") se fija al **Modulo 00** del curso — el
  // libro del curso — sin importar el módulo/lección actual del alumno. Excepción:
  // IMPULSA no tiene Modulo 00 y su material vive por lección → conserva el módulo
  // actual (comportamiento de hoy).
  const esImpulsa = (curso || '').trim().toUpperCase() === 'IMPULSA';
  const materialModulo = esImpulsa ? nivel : 'Modulo 00';
  const materials = await getStudentMaterials(materialModulo, curso);
  return successResponse({ materials, nivel, curso, materialModulo });
});
