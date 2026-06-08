/**
 * Audios de un libro interactivo (admin).
 *
 * GET  /api/admin/libros-interactivos/[codigo]/audios
 *   Lista los audios actuales del libro.
 *
 * POST /api/admin/libros-interactivos/[codigo]/audios
 *   Body: { pagina: number, key: string, titulo?: string }
 *   Upsert por página (si ya hay audio en esa página lo reemplaza).
 *   `key` es la ruta RELATIVA dentro del libro: "audio/page-012.mp3".
 *
 * DELETE /api/admin/libros-interactivos/[codigo]/audios?pagina=12
 *   Elimina el audio asociado a esa página (no borra el archivo de Spaces,
 *   solo lo desliga — el archivo queda huérfano y puede limpiarse con un
 *   script posterior).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosRepository } from '@/repositories/libros-interactivos.repository';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';

export const GET = handlerWithAuth(async (_req, ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const codigo = String(ctx.params.codigo || '').toUpperCase().trim();
  const libro = await LibrosInteractivosRepository.findByCodigo(codigo);
  if (!libro) throw new NotFoundError('LibroInteractivo', codigo);
  return successResponse({ codigo, audios: libro.audios || [] });
});

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const codigo = String(ctx.params.codigo || '').toUpperCase().trim();
  const body = await req.json().catch(() => ({}));
  const pagina = Number(body?.pagina);
  const key = String(body?.key || '').trim();
  const titulo = body?.titulo ? String(body.titulo).trim() : null;
  if (!Number.isInteger(pagina) || pagina < 1) {
    throw new ValidationError('pagina debe ser entero >= 1');
  }
  if (!key || !key.startsWith('audio/')) {
    throw new ValidationError('key inválida (debe empezar con "audio/")');
  }
  await LibrosInteractivosRepository.upsertAudio(codigo, { pagina, key, titulo });
  return successResponse({ ok: true });
});

export const DELETE = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const codigo = String(ctx.params.codigo || '').toUpperCase().trim();
  const paginaStr = new URL(req.url).searchParams.get('pagina');
  const pagina = paginaStr ? parseInt(paginaStr, 10) : NaN;
  if (!Number.isInteger(pagina) || pagina < 1) {
    throw new ValidationError('querystring "pagina" requerida');
  }
  await LibrosInteractivosRepository.removeAudio(codigo, pagina);
  return successResponse({ ok: true });
});
