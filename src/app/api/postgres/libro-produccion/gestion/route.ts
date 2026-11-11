import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission, tienePermiso } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { gestionComercial } from '@/services/libro-produccion.service';

/**
 * GET /api/postgres/libro-produccion/gestion?anio=2026&mes=11   (mes vacío = todo el año)
 * Pestaña "Gestión" del Libro de Producción (Gestión Comercial): contratos de la vigencia
 * comercial con país, filial, semana, grupo de estado y escala. Agregación en el cliente.
 * Gate: sesión + APROBACION.LIBRO_PRODUCCION.GESTION. El nombre del titular solo viaja
 * a quien además tiene APROBACION.LIBRO_PRODUCCION.VER.
 */
export const GET = handlerWithAuth(async (req: NextRequest, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_GESTION);
  const sp = new URL(req.url).searchParams;
  const anio = parseInt(sp.get('anio') || '', 10) || new Date().getFullYear();
  const mes = parseInt(sp.get('mes') || '', 10);
  const conTitular = await tienePermiso(session, AprobacionPermission.LIBRO_PRODUCCION_VER);
  return successResponse(await gestionComercial(anio, mes >= 1 && mes <= 12 ? mes : null, { conTitular }));
});
