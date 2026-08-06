/**
 * GET /api/postgres/libros-interactivos/[nivel]/page?n=12
 *
 * Devuelve presigned URL (10 min) de la imagen de la página local n del nivel.
 * La traducción página-local → página-libro se hace server-side usando el rango.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { ValidationError } from '@/lib/errors';

export const GET = handlerWithAuth(async (req, ctx) => {
  const nivel = decodeURIComponent(ctx.params.nivel || '').toUpperCase().trim();
  const sp = new URL(req.url).searchParams;
  const nStr = sp.get('n');
  const modulo = sp.get('modulo')?.trim() || null;
  const n = nStr ? parseInt(nStr, 10) : NaN;
  if (!nivel || !Number.isInteger(n) || n < 1) {
    throw new ValidationError('Parámetros inválidos (nivel + n requeridos)');
  }
  const url = await LibrosInteractivosService.getPagePresignedUrl(nivel, n, modulo);
  return successResponse({ url, pagina: n });
});
