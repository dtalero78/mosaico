import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/approvals/aprobados
 *
 * Titulares con contrato APROBADO, INACTIVO o FINALIZADO (consulta del ítem
 * "Aprobados" del submenú Aprobación). Incluye la campaña (de un beneficiario del
 * contrato). Gateado por APROBACION.APROBADOS.VER.
 */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.APROBADOS_VER);

  const result = await query(
    `SELECT p."_id", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."numeroId", p."contrato", p."celular", p."email", p."plataforma", p."tipoUsuario",
            p."aprobacion", p."estado", p."estadoInactivo", p."hashConsentimiento", p."extemporanea",
            p."finalContrato"::text AS "finalContrato",
            p."_createdDate", p."fechaCreacion",
            camp."campaign"
     FROM "PEOPLE" p
     LEFT JOIN LATERAL (
       SELECT "campaign" FROM "PEOPLE"
       WHERE "contrato" = p."contrato" AND "tipoUsuario" = 'BENEFICIARIO' AND "campaign" IS NOT NULL
       LIMIT 1
     ) camp ON true
     WHERE p."tipoUsuario" = 'TITULAR'
       AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
       AND (
         p."aprobacion" IN ('Aprobado','Aprobada','FINALIZADA')
         OR p."estado" = 'FINALIZADA'
         OR p."estadoInactivo" = true
       )
     ORDER BY p."_createdDate" DESC`
  );

  return successResponse({ approvals: result.rows, count: result.rowCount || 0 });
});
