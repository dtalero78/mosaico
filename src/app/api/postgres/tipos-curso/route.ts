import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import {
  listarTiposCurso, crearTipoCurso, actualizarTipoCurso,
} from '@/services/tipos-curso.service';

/**
 * Catálogo de tipos de curso (Académico › Tipos de Curso).
 *
 * GET lo consumen además todos los desplegables de curso de la app, así que NO
 * exige el permiso de gestión: basta estar autenticado. Escribir sí lo exige.
 */

export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const incluirInactivos = searchParams.get('incluirInactivos') === 'true';
  const tipos = await listarTiposCurso({ incluirInactivos });
  return successResponse({ tipos });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.TIPOS_CURSO_GESTION);
  const body = await request.json().catch(() => ({}));
  const tipo = await crearTipoCurso({
    tipoCurso: body?.tipoCurso,
    esMenores: body?.esMenores,
    usaApoderado: body?.usaApoderado,
    orden: body?.orden,
  });
  return successResponse({ tipo });
});

export const PATCH = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.TIPOS_CURSO_GESTION);
  const body = await request.json().catch(() => ({}));
  const id = String(body?._id || '').trim();
  if (!id) return successResponse({ error: 'Falta _id' }, 400 as any);
  const tipo = await actualizarTipoCurso(id, {
    esMenores: body?.esMenores,
    usaApoderado: body?.usaApoderado,
    orden: body?.orden,
    activo: body?.activo,
  });
  return successResponse({ tipo });
});
