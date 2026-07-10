import { handler, successResponse } from '@/lib/api-helpers';
import { NivelesRepository } from '@/repositories/niveles.repository';

/**
 * GET /api/postgres/niveles[?curso=YOJI]
 *
 * Sin `curso`: niveles agrupados por code con steps/clubs (motor LGS).
 * Con `curso` (MOSAICO): devuelve los MÓDULOS (code) y LECCIONES (step) de ese curso,
 * ordenados por `orden`, en `modulos: [{ code, steps: string[] }]`. NIVELES tiene el
 * code (módulo) repetido por curso, por eso se filtra por curso para no mezclarlos.
 */
export const GET = handler(async (request: Request) => {
  const curso = new URL(request.url).searchParams.get('curso');
  const rows = await NivelesRepository.findAll();

  // ── MOSAICO: módulos + lecciones de un curso, ordenados por `orden` ──
  if (curso) {
    const delCurso = rows.filter((r: any) => r.curso === curso);
    const mapMod = new Map<string, { code: string; minOrden: number; steps: Array<{ step: string; orden: number }> }>();
    for (const r of delCurso) {
      if (!r.code) continue;
      const orden = Number(r.orden) || 0;
      if (!mapMod.has(r.code)) mapMod.set(r.code, { code: r.code, minOrden: orden, steps: [] });
      const m = mapMod.get(r.code)!;
      if (orden < m.minOrden) m.minOrden = orden;
      if (r.step && !m.steps.some(s => s.step === r.step)) m.steps.push({ step: r.step, orden });
    }
    const modulos = Array.from(mapMod.values())
      .sort((a, b) => a.minOrden - b.minOrden)
      .map(m => ({ code: m.code, steps: m.steps.sort((a, b) => a.orden - b.orden).map(s => s.step) }));

    // Clubs (Talleres) del curso: por lección (step) y agregados del curso.
    // NIVELES.clubs es un array por fila (curso+módulo+lección), ej. ["BASICO - Leccion 02", …].
    const clubsPorLeccion: Record<string, string[]> = {};
    const clubsCursoSet = new Set<string>();
    for (const r of delCurso) {
      if (!Array.isArray(r.clubs) || !r.step) continue;
      for (const c of r.clubs) {
        if (!c) continue;
        (clubsPorLeccion[r.step] ||= []);
        if (!clubsPorLeccion[r.step].includes(c)) clubsPorLeccion[r.step].push(c);
        clubsCursoSet.add(c);
      }
    }
    return successResponse({ curso, modulos, clubsPorLeccion, clubsCurso: Array.from(clubsCursoSet), total: modulos.length });
  }

  // Group rows by code to build a single object per level
  const byCode = new Map<string, any>();
  for (const row of rows) {
    if (!byCode.has(row.code)) {
      byCode.set(row.code, {
        code: row.code,
        esParalelo: row.esParalelo,
        orden: row.orden,
        steps: [],
        clubs: [],
      });
    }
    const nivel = byCode.get(row.code)!;

    // Collect unique step names
    if (row.step && !nivel.steps.includes(row.step)) {
      nivel.steps.push(row.step);
    }

    // Collect unique clubs from each row's clubs JSONB array
    if (Array.isArray(row.clubs)) {
      for (const club of row.clubs) {
        if (!nivel.clubs.includes(club)) {
          nivel.clubs.push(club);
        }
      }
    }
  }

  const niveles = Array.from(byCode.values());

  // Sort steps numerically within each level
  for (const nivel of niveles) {
    nivel.steps.sort((a: string, b: string) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });
  }

  return successResponse({ niveles, data: niveles, total: niveles.length });
});
