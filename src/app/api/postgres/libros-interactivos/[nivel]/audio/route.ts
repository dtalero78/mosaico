/**
 * GET /api/postgres/libros-interactivos/[nivel]/audio?n=12
 *
 * Devuelve TODOS los audios asociados a la página local n.
 * Una página puede tener 0..N audios.
 *
 * Respuesta:
 *   - sin audios: { available: false, audios: [] }
 *   - con audios: { available: true, audios: [{idx, titulo, url}, ...] }
 *
 * El cliente debe iterar el array y renderizar un reproductor por cada audio.
 * Para mantener compatibilidad con clientes viejos que esperan `url` única,
 * se incluye `url` con la del PRIMER audio (puede ser null).
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
  const audios = await LibrosInteractivosService.getAudiosForPage(nivel, n, modulo);
  if (audios.length === 0) {
    return successResponse({ available: false, audios: [] });
  }
  return successResponse({
    available: true,
    pagina: n,
    audios,
    url: audios[0]?.url ?? null, // compat
  });
});
