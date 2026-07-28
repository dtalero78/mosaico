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
  let kahootNombre: string | null = null;
  let wordwallNombre: string | null = null;
  let recursos: { nombre: string; link: string }[] = [];
  if (curso && modulo && leccion) {
    // Comparación insensible a acentos/mayúsculas: NIVELES usa "Lección" y el
    // alumno puede tener "Leccion" (sin tilde). translate() no requiere extensión.
    const norm = (c: string) => `translate(lower(${c}),'áéíóúñ','aeioun')`;
    const row = await queryOne<{
      actividadKahoot: string | null; actividadWordwall: string | null;
      actividadKahootNombre: string | null; actividadWordwallNombre: string | null;
    }>(
      `SELECT "actividadKahoot", "actividadWordwall", "actividadKahootNombre", "actividadWordwallNombre"
         FROM "NIVELES"
       WHERE "curso" = $1
         AND ${norm('"code"')} = ${norm('$2')}
         AND ${norm('"step"')} = ${norm('$3')}
       LIMIT 1`,
      [curso, modulo, leccion]
    );
    kahoot = row?.actividadKahoot || null;
    wordwall = row?.actividadWordwall || null;
    kahootNombre = row?.actividadKahootNombre || null;
    wordwallNombre = row?.actividadWordwallNombre || null;

    // Recursos del MÓDULO (uniformes en todas las lecciones): tomo la 1ª fila del módulo con datos.
    const rec = await queryOne<{ recursos: any }>(
      `SELECT "recursos" FROM "NIVELES"
        WHERE "curso" = $1 AND ${norm('"code"')} = ${norm('$2')}
          AND "recursos" IS NOT NULL AND jsonb_array_length(COALESCE("recursos",'[]'::jsonb)) > 0
        LIMIT 1`,
      [curso, modulo]
    );
    const raw = Array.isArray(rec?.recursos) ? rec!.recursos
      : (typeof rec?.recursos === 'string' ? (() => { try { return JSON.parse(rec!.recursos as any); } catch { return []; } })() : []);
    recursos = (Array.isArray(raw) ? raw : [])
      .map((x: any) => ({ nombre: String(x?.nombre || '').trim(), link: String(x?.link || '').trim() }))
      .filter((x) => x.link);
  }

  return successResponse({ kahoot, wordwall, kahootNombre, wordwallNombre, recursos, curso, modulo, leccion });
});
