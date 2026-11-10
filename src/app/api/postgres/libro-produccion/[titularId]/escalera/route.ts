import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { opcionesEscalera, actualizarEscalera } from '@/services/libro-produccion.service';

/**
 * GET   /api/postgres/libro-produccion/[titularId]/escalera  → valores actuales, sugerencias y filiales del país.
 * PATCH /api/postgres/libro-produccion/[titularId]/escalera  Body: { asesorCreadorContrato?, fullExecutive?, jefeGrupo?,
 *        gerente?, gerenteDivision?, salesManager?, filial?, origenMatricula?, motivo }
 * Botón "Ajuste Escala" del detalle del Libro de Producción. Queda en el Seguimiento del contrato.
  * Gate: APROBACION.LIBRO_PRODUCCION.ESCALERA.
 */
export const GET = handlerWithAuth(async (_req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_ESCALERA);
  return successResponse(await opcionesEscalera(ctx.params.titularId));
});

export const PATCH = handlerWithAuth(async (req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_ESCALERA);
  const body = await req.json().catch(() => ({}));
  const { motivo, ...datos } = body || {};
  return successResponse(await actualizarEscalera(ctx.params.titularId, datos, motivo, session));
});
