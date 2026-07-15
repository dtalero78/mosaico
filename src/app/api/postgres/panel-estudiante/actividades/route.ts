import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { queryOne } from '@/lib/postgres';

/**
 * GET /api/postgres/panel-estudiante/actividades
 *
 * Actividades externas (Kahoot / WordWall) de la LECCIÓN ACTUAL del alumno,
 * leídas de NIVELES (curso + módulo=code + lección=step).
 */
export const GET = handlerWithAuth(async (_request, _context, session) => {
  const student = await resolveStudentFromSession(session);
  const curso = (student as any).tipoCurso || (student as any).curso || '';
  const modulo = student.nivel || '';
  const leccion = student.step || '';

  let kahoot: string | null = null;
  let wordwall: string | null = null;
  if (curso && modulo && leccion) {
    // Comparación insensible a acentos/mayúsculas: NIVELES usa "Lección" y el
    // alumno puede tener "Leccion" (sin tilde). translate() no requiere extensión.
    const norm = (c: string) => `translate(lower(${c}),'áéíóúñ','aeioun')`;
    const row = await queryOne<{ actividadKahoot: string | null; actividadWordwall: string | null }>(
      `SELECT "actividadKahoot", "actividadWordwall" FROM "NIVELES"
       WHERE "curso" = $1
         AND ${norm('"code"')} = ${norm('$2')}
         AND ${norm('"step"')} = ${norm('$3')}
       LIMIT 1`,
      [curso, modulo, leccion]
    );
    kahoot = row?.actividadKahoot || null;
    wordwall = row?.actividadWordwall || null;
  }

  return successResponse({ kahoot, wordwall, curso, modulo, leccion });
});
