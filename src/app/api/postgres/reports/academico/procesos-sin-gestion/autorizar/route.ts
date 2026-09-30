/**
 * POST /api/postgres/reports/academico/procesos-sin-gestion/autorizar
 *
 * Marca o desmarca la casilla "Autoriza" de Procesos sin gestión, de a una fila o
 * en bloque. Una fila autorizada le reabre al GUÍA ese proceso aunque su plazo
 * haya vencido; sin la marca, no puede gestionarlo.
 *
 * Body:
 *   { tipo: 'SESION' | 'EVENTO_ADMIN', autorizar: boolean, refIds: string[] }
 *   { tipo: 'REPORTE', autorizar: boolean, items: [{ campaign, curso, salon, semanaInicio }] }
 *
 * Máximo 500 por llamada (la pantalla parte los lotes más grandes).
 *
 * Permiso: ACADEMICO.PROCESOS_SIN_GESTION.AUTORIZAR. El rol GUIA no puede
 * autorizar aunque tenga el permiso: se autorizaría a sí mismo.
 *
 * Quién autoriza sale de la SESIÓN, nunca del body.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { esTipoAutorizacion } from '@/lib/autorizacion-gestion';
import { aplicarAutorizaciones, puedeAutorizarGestion } from '@/services/autorizacion-gestion.service';

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  if (!(await puedeAutorizarGestion(session))) {
    throw new ForbiddenError('No tienes permiso para autorizar procesos sin gestión.');
  }

  const b = await request.json().catch(() => ({}));
  if (!esTipoAutorizacion(b?.tipo)) throw new ValidationError('tipo debe ser SESION, EVENTO_ADMIN o REPORTE.');
  if (typeof b?.autorizar !== 'boolean') throw new ValidationError('Falta indicar si se autoriza o se quita la autorización.');

  const user = (session?.user as any) || {};
  const resultado = await aplicarAutorizaciones({
    tipo: b.tipo,
    autorizar: b.autorizar,
    refIds: Array.isArray(b?.refIds) ? b.refIds : [],
    items: Array.isArray(b?.items) ? b.items : [],
    actor: { email: user.email || 'desconocido', nombre: user.name || null },
  });

  return successResponse({ ...resultado, autorizar: b.autorizar });
});
