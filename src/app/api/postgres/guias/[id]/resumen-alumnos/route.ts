/**
 * GET /api/postgres/guias/[id]/resumen-alumnos   [id] = GUIAS._id
 *
 * Panel del guía › "Mis alumnos por curso": los cursos vigentes del guía con una
 * fila por alumno (métricas + alertas) y las tarjetas de resumen. Sólo lectura.
 *
 * Acceso (validado aquí, no en la pantalla — devuelve nombres y datos de alumnos):
 *  - `ACADEMICO.PANEL_ALUMNOS.VER` para entrar;
 *  - rol GUIA → sólo su propio panel (resuelto por su correo, no por el id pedido);
 *  - otros roles → cualquier guía con `ACADEMICO.PANEL_ALUMNOS.VER_TODOS`, si no
 *    sólo el propio. SUPER_ADMIN/ADMIN pasan siempre.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission, tienePermiso } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ForbiddenError } from '@/lib/errors';
import { puedeVerPanelGuia } from '@/lib/alcance-guia';
import { esRolGuia, guiaIdDeSesion } from '@/services/guia-sesion.service';
import { getResumenGuia } from '@/services/resumen-guia.service';

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, AcademicoPermission.PANEL_ALUMNOS_VER);

  const esGuia = esRolGuia(session);
  const permitido = puedeVerPanelGuia({
    esGuia,
    verTodos: !esGuia && await tienePermiso(session, AcademicoPermission.PANEL_ALUMNOS_VER_TODOS),
    guiaDeSesion: await guiaIdDeSesion((session as any)?.user?.email),
    guiaPedido: params.id,
  });
  if (!permitido) throw new ForbiddenError('Sólo puedes ver el panel de tus propios cursos');

  return successResponse(await getResumenGuia(params.id));
});
