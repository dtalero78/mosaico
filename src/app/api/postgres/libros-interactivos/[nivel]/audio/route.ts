/**
 * GET /api/postgres/libros-interactivos/[nivel]/audio?n=12
 *
 * Devuelve presigned URL del audio asociado a la página local n.
 * Si esa página no tiene audio, responde {available:false}.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { ValidationError } from '@/lib/errors';

export const GET = handlerWithAuth(async (req, ctx) => {
  const nivel = decodeURIComponent(ctx.params.nivel || '').toUpperCase().trim();
  const nStr = new URL(req.url).searchParams.get('n');
  const n = nStr ? parseInt(nStr, 10) : NaN;
  if (!nivel || !Number.isInteger(n) || n < 1) {
    throw new ValidationError('Parámetros inválidos (nivel + n requeridos)');
  }
  const url = await LibrosInteractivosService.getAudioPresignedUrl(nivel, n);
  if (!url) return successResponse({ available: false });
  return successResponse({ available: true, url, pagina: n });
});
