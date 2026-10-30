import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import {
  listarFestivos, previsualizar, crearFestivo, festivosConSesionesPendientes,
  eventosSueltosEnFestivos, cursosParaElegir, type Alcance,
} from '@/services/festivos-personalizados.service';
import { cursosImpulsaParaElegir, aplicarFestivoImpulsa } from '@/services/festivos-impulsa.service';

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
  const sp = new URL(request.url).searchParams;
  if (fecha) {
    const alcance = (sp.get('alcance') || 'TODOS') as Alcance;
    const cursoIds = (sp.get('cursoIds') || '').split(',').map((x) => x.trim()).filter(Boolean);
    return successResponse({ preview: await previsualizar(fecha, alcance, cursoIds) });
  }
  const [festivos, pendientes, sueltos, cursos, cursosImpulsa] = await Promise.all([
    listarFestivos(),
    festivosConSesionesPendientes(),
    eventosSueltosEnFestivos(),
    cursosParaElegir(),
    cursosImpulsaParaElegir(),
  ]);
  return successResponse({ festivos, pendientes, sueltos, cursos, cursosImpulsa });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const body = await request.json().catch(() => ({}));
  const actor = {
    email: (session?.user as any)?.email || null,
    nombre: (session?.user as any)?.name || null,
  };
  const r = await crearFestivo(body?.fecha, body?.motivo, actor, (body?.alcance || 'TODOS') as Alcance,
    Array.isArray(body?.cursoIds) ? body.cursoIds : []);
  // IMPULSA: no se regenera; se quita sólo la clase del día y se corre al final.
  const impulsa = (body?.alcance === 'IMPULSA') ? await aplicarFestivoImpulsa(r.festivo.fecha, r.festivo.cursoIds) : undefined;
  return successResponse({ ...r, impulsa });
});
