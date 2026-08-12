import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryMany } from '@/lib/postgres';

/**
 * GET /api/postgres/materials/books
 *
 * Devuelve los materialUsuario (PDFs/libros) de NIVELES para descargar.
 *
 * Filtros opcionales:
 *   - guiaId=<GUIAS._id>  → sólo los cursos que dicta ese guía (CURSOS_CAMPAIGN.guia).
 *   - curso=<TIPO>        → sólo ese curso (ej. KODOMO).
 *   - modulo00=1          → los cursos MOSAICO se restringen a `code='Modulo 00'` (el
 *                           libro del curso); **IMPULSA queda SIN restricción de módulo**
 *                           (muestra todas sus lecciones, como hoy), porque IMPULSA no
 *                           tiene Modulo 00 y su material vive por lección.
 *
 * Sin filtros = comportamiento previo (todos los cursos, todos los módulos).
 */
export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const guiaId    = (searchParams.get('guiaId') || '').trim();
  const curso     = (searchParams.get('curso') || '').trim();
  const modulo00  = searchParams.get('modulo00') === '1' || searchParams.get('modulo00') === 'true';

  const conds: string[] = [`"materialUsuario" IS NOT NULL`];
  const params: any[] = [];

  if (guiaId) {
    params.push(guiaId);
    conds.push(
      `UPPER("curso") IN (SELECT UPPER("tipoCurso") FROM "CURSOS_CAMPAIGN" WHERE "guia" = $${params.length} AND "activa" = true)`
    );
  }
  if (curso) {
    params.push(curso);
    conds.push(`UPPER("curso") = UPPER($${params.length})`);
  }
  if (modulo00) {
    // MOSAICO → sólo Modulo 00; IMPULSA → sin restricción (todas sus lecciones).
    conds.push(`(UPPER("curso") = 'IMPULSA' OR "code" = 'Modulo 00')`);
  }

  const rows = await queryMany(
    `SELECT "curso", "code", "step", "materialUsuario"
     FROM "NIVELES"
     WHERE ${conds.join(' AND ')}
     ORDER BY "curso" ASC, "code" ASC, "step" ASC`,
    params
  );

  const seen = new Set<string>();
  const books: { name: string; url: string; curso: string; nivel: string; step: string }[] = [];

  for (const row of rows) {
    const userMats = row.materialUsuario || [];
    if (Array.isArray(userMats)) {
      for (const key of userMats) {
        if (typeof key === 'string' && key.startsWith('materials/') && !seen.has(key)) {
          seen.add(key);
          const filename = decodeURIComponent(key.split('/').pop() || key);
          books.push({
            name: filename.replace(/\.pdf$/i, ''),
            url: `/api/postgres/niveles/material?key=${encodeURIComponent(key)}`,
            curso: row.curso || 'Sin curso',
            nivel: row.code || '',
            step: row.step || '',
          });
        }
      }
    }
  }

  return successResponse({ books });
});
