/**
 * Audios de un libro interactivo (admin).
 *
 * Una página puede tener MÚLTIPLES audios. La unicidad se controla por `key`
 * (la ruta relativa dentro del libro).
 *
 * GET  /api/admin/libros-interactivos/[codigo]/audios
 *   Lista todos los audios actuales del libro (de todas las páginas).
 *
 * POST /api/admin/libros-interactivos/[codigo]/audios
 *   Body: { pagina: number, key: string, titulo?: string }
 *   Agrega un audio. Si ya existía otro con la MISMA key lo reemplaza
 *   (idempotente — sirve para re-subir el mismo archivo). Múltiples
 *   audios en la misma página se permiten siempre que tengan keys distintas.
 *
 * DELETE /api/admin/libros-interactivos/[codigo]/audios?key=audio/page-008-dialogo.mp3
 *   Elimina el audio cuya key coincida. NO borra el archivo de Spaces
 *   (queda huérfano y puede limpiarse con un script posterior).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosRepository } from '@/repositories/libros-interactivos.repository';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
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
  await LibrosInteractivosRepository.addAudio(codigo, { pagina, key, titulo });
  LibrosInteractivosService.invalidateLibroCache(codigo);
  return successResponse({ ok: true });
});

export const DELETE = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const codigo = String(ctx.params.codigo || '').toUpperCase().trim();
  const key = new URL(req.url).searchParams.get('key');
  if (!key || !key.startsWith('audio/')) {
    throw new ValidationError('querystring "key" requerida (debe empezar con "audio/")');
  }
  await LibrosInteractivosRepository.removeAudio(codigo, key);
  LibrosInteractivosService.invalidateLibroCache(codigo);
  return successResponse({ ok: true });
});

/**
 * PATCH /api/admin/libros-interactivos/[codigo]/audios
 * Body: { key: string, titulo: string | null }
 *
 * Actualiza solo el título de un audio existente. No re-sube el archivo,
 * solo cambia el label que ven los estudiantes. Útil para titular audios
 * viejos (subidos antes del feature de títulos) sin tocar Spaces.
 *
 * `titulo: null | ''` limpia el título — el visor lo mostrará como "Audio N".
 */
export const PATCH = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const codigo = String(ctx.params.codigo || '').toUpperCase().trim();
  const body = await req.json().catch(() => ({}));
  const key = String(body?.key || '').trim();
  if (!key || !key.startsWith('audio/')) {
    throw new ValidationError('key inválida (debe empezar con "audio/")');
  }
  const titulo = body?.titulo == null || body?.titulo === ''
    ? null
    : String(body.titulo).trim().slice(0, 80);

  const updated = await LibrosInteractivosRepository.updateAudioTitulo(codigo, key, titulo);
  if (!updated) throw new NotFoundError('AudioLibroInteractivo', key);

  LibrosInteractivosService.invalidateLibroCache(codigo);
  return successResponse({ ok: true, titulo });
});
