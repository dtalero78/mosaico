/**
 * GET /api/postgres/libros-interactivos/[nivel]
 *
 * Metadata del libro asociado al nivel:
 *   - libroCodigo, libroTitulo
 *   - totalPaginas   (las que ve el estudiante: dentro del rango)
 *   - paginasConAudio (lista de páginas locales con audio)
 *   - featureActive  (flag global)
 *
 * Si el flag está OFF o el nivel no tiene libro asignado, devuelve
 * `available: false` (sin error) para que la UI muestre el botón clásico (Wix).
 */
import { handler, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { NotFoundError } from '@/lib/errors';

export const GET = handler(async (_req, ctx) => {
  const nivel = decodeURIComponent(ctx.params.nivel || '').toUpperCase().trim();
  if (!nivel) return successResponse({ available: false });

  const featureActive = await LibrosInteractivosService.isFeatureActive();
  if (!featureActive) {
    return successResponse({ available: false, featureActive: false });
  }

  try {
    const metadata = await LibrosInteractivosService.getMetadataForNivel(nivel);
    return successResponse({
      available: true,
      featureActive: true,
      ...metadata,
    });
  } catch (err: any) {
    // Si el libro no existe o no tiene páginas, no es un error de aplicación:
    // simplemente la feature no está disponible para ese nivel todavía.
    if (err instanceof NotFoundError) {
      return successResponse({ available: false, featureActive: true });
    }
    throw err;
  }
});
