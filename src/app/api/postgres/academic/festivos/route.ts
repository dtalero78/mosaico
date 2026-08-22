import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import {
  listarFestivos, previsualizar, crearFestivo, festivosConSesionesPendientes,
  eventosSueltosEnFestivos,
} from '@/services/festivos-personalizados.service';

/**
 * GET  /api/postgres/academic/festivos            → lista + los que aún tienen clases
 * GET  /api/postgres/academic/festivos?fecha=...  → vista previa del impacto de esa fecha
 * POST /api/postgres/academic/festivos            → declara un festivo { fecha, motivo }
 *
 * El autor sale de la sesión, no del body.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const fecha = new URL(request.url).searchParams.get('fecha');
  if (fecha) return successResponse({ preview: await previsualizar(fecha) });
  const [festivos, pendientes, sueltos] = await Promise.all([
    listarFestivos(),
    festivosConSesionesPendientes(),
    eventosSueltosEnFestivos(),
  ]);
  return successResponse({ festivos, pendientes, sueltos });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const body = await request.json().catch(() => ({}));
  const actor = {
    email: (session?.user as any)?.email || null,
    nombre: (session?.user as any)?.name || null,
  };
  const r = await crearFestivo(body?.fecha, body?.motivo, actor);
  return successResponse(r);
});
