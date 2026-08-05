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
  let kahootModulo: string | null = null;
  let wordwallModulo: string | null = null;
  let kahootModuloNombre: string | null = null;
  let wordwallModuloNombre: string | null = null;
  let recursos: { nombre: string; link: string }[] = [];
  let actividadesWordwall: { nombre: string; link: string }[] = [];
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

    // Actividades del MÓDULO (uniformes en todas las lecciones): 1ª fila del módulo con datos.
    const act = await queryOne<{
      k: string | null; kn: string | null; w: string | null; wn: string | null;
    }>(
      `SELECT MAX("actividadKahootModulo") AS k, MAX("actividadKahootModuloNombre") AS kn,
              MAX("actividadWordwallModulo") AS w, MAX("actividadWordwallModuloNombre") AS wn
         FROM "NIVELES"
        WHERE "curso" = $1 AND ${norm('"code"')} = ${norm('$2')}`,
      [curso, modulo]
    );
    kahootModulo = act?.k || null;
    kahootModuloNombre = act?.kn || null;
    wordwallModulo = act?.w || null;
    wordwallModuloNombre = act?.wn || null;

    // Lista abierta de actividades WordWall del MÓDULO (nueva; Kahoot descontinuado).
    const aww = await queryOne<{ arr: any }>(
      `SELECT "actividadesWordwallModulo" AS arr FROM "NIVELES"
        WHERE "curso" = $1 AND ${norm('"code"')} = ${norm('$2')}
          AND jsonb_array_length(COALESCE("actividadesWordwallModulo",'[]'::jsonb)) > 0
        LIMIT 1`,
      [curso, modulo]
    );
    const rawAww = Array.isArray(aww?.arr) ? aww!.arr
      : (typeof aww?.arr === 'string' ? (() => { try { return JSON.parse(aww!.arr as any); } catch { return []; } })() : []);
    actividadesWordwall = (Array.isArray(rawAww) ? rawAww : [])
      .map((x: any) => ({ nombre: String(x?.nombre || '').trim(), link: String(x?.link || '').trim() }))
      .filter((x) => x.link);
  }

  return successResponse({
    kahoot, wordwall, kahootNombre, wordwallNombre,
    kahootModulo, wordwallModulo, kahootModuloNombre, wordwallModuloNombre,
    actividadesWordwall,
    recursos, curso, modulo, leccion,
  });
});
