import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/recaudos/aprobaciones
 *
 * Titulares APROBADOS y ACTIVOS (candidatos a asignar gestor de recaudo):
 *   aprobacion='Aprobado' AND estadoInactivo IS NOT TRUE AND estado='ACTIVA'.
 * Excluye contratos de prueba (PRB-). Devuelve `gestorRecaudo` para calcular la
 * columna "Asignado" (Sí/No) en el cliente.
 *
 * Gateado por RECAUDOS.APROBACIONES.VER. El scope por plataforma NO es
 * automático: los jefes filtran con el dropdown de Plataforma en la UI.
 */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.APROBACIONES_VER);

  // MOSAICO no tiene "fechaIngreso" (columna LGS); se usa "fechaContrato" como
  // equivalente (fecha del contrato) y se expone AS "fechaIngreso" para que la UI
  // (columna "Fecha Aprobación") funcione sin cambios.
  const result = await query(
    `SELECT "_id", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
            "numeroId", "contrato", "celular", "email", "plataforma",
            "gestorRecaudo", "_createdDate", "fechaContrato" AS "fechaIngreso"
     FROM "PEOPLE"
     WHERE "tipoUsuario" = 'TITULAR'
       AND COALESCE("contrato",'') NOT LIKE 'PRB-%'
       AND "aprobacion" = 'Aprobado'
       AND "estadoInactivo" IS NOT TRUE
       AND "estado" = 'ACTIVA'
     ORDER BY "fechaContrato" DESC NULLS LAST, "_createdDate" DESC`
  );

  return successResponse({
    approvals: result.rows,
    count: result.rowCount || 0,
  });
});
