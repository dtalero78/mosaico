/**
 * GET /api/postgres/libros-interactivos/[nivel]
 *
 * Metadata del libro asociado al nivel (curso) del estudiante:
 *   - libroCodigo, libroTitulo
 *   - totalPaginas   (las que ve el estudiante: dentro del rango)
 *   - paginasConAudio (lista de páginas locales con audio)
 *
 * En MOSAICO hay un solo material interactivo por curso (sin coexistencia con
 * Wix ni feature flag): `available: true` cuando el curso tiene un libro con
 * páginas cargadas, `available: false` (sin error) cuando aún no se ha subido.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const GET = handlerWithAuth(async (_req, ctx) => {
  const nivel = decodeURIComponent(ctx.params.nivel || '').toUpperCase().trim();
  if (!nivel) return successResponse({ available: false });

  try {
    const metadata = await LibrosInteractivosService.getMetadataForNivel(nivel);
    return successResponse({ available: true, ...metadata });
  } catch (err: any) {
    // Sin libro asignado o sin páginas cargadas todavía → la feature simplemente
    // no está disponible para ese curso (no es un error de aplicación).
    if (err instanceof NotFoundError || err instanceof ValidationError) {
      return successResponse({ available: false });
    }
    throw err;
  }
});
