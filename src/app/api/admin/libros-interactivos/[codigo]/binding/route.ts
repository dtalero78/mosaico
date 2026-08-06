/**
 * PATCH /api/admin/libros-interactivos/[codigo]/binding
 *
 * Body: { nivelCode: string, libroInteractivoCode: string|null,
 *         libroPaginaInicio: number|null, libroPaginaFin: number|null }
 *
 * Reconfigura el binding de un nivel hacia un libro + rango. El `codigo` del
 * path es informativo (el libro al que pertenece el nivel, para tracking) —
 * lo que manda es el body, así que un admin puede mover un nivel a otro libro
 * llamando con el código del libro DESTINO.
 *
 * Gateado por permiso ACADEMICO.MATERIAL.ACTUALIZAR.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NivelLibroBindingRepository } from '@/repositories/libros-interactivos.repository';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';

export const PATCH = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const body = await req.json().catch(() => ({}));

  // NO uppercasear: los módulos MOSAICO son "Modulo 00" (mixto); NIVELES.code es exacto.
  const nivelCode = String(body?.nivelCode || '').trim();
  if (!nivelCode) throw new ValidationError('nivelCode requerido');

  const libroInteractivoCode = body?.libroInteractivoCode
    ? String(body.libroInteractivoCode).toUpperCase().trim()
    : null;

  // Curso al que pertenece el módulo (el code se repite entre cursos en MOSAICO).
  // Sin curso, el binding se aplicaría a todos los cursos con ese code.
  const curso = body?.curso ? String(body.curso).trim() : null;

  const inicio = body?.libroPaginaInicio != null ? Number(body.libroPaginaInicio) : null;
  const fin    = body?.libroPaginaFin    != null ? Number(body.libroPaginaFin)    : null;

  if (inicio != null && (!Number.isInteger(inicio) || inicio < 1)) {
    throw new ValidationError('libroPaginaInicio debe ser entero >= 1');
  }
  if (fin != null && (!Number.isInteger(fin) || fin < 1)) {
    throw new ValidationError('libroPaginaFin debe ser entero >= 1');
  }
  if (inicio != null && fin != null && fin < inicio) {
    throw new ValidationError('libroPaginaFin no puede ser menor que libroPaginaInicio');
  }

  const affected = await NivelLibroBindingRepository.setBinding({
    code: nivelCode,
    curso,
    libroInteractivoCode,
    libroPaginaInicio: inicio,
    libroPaginaFin: fin,
  });

  // Invalidar cache para que el visor refleje el cambio sin esperar TTL.
  LibrosInteractivosService.invalidateNivelCache(nivelCode);

  return successResponse({ affected, nivelCode });
});
