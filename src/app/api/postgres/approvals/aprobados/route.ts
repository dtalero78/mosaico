import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/approvals/aprobados
 *
 * Titulares con contrato APROBADO o FINALIZADO (consulta del ítem "Aprobados"
 * del submenú Aprobación). Incluye la campaña (de un beneficiario del contrato).
 * Gateado por APROBACION.APROBADOS.VER.
 *
 * **No se mira `estadoInactivo`**: esa condición metía aquí contratos que NO
 * están aprobados. Los estados "Contrato nulo", "Devuelto" y "Rechazado"
 * inactivan automáticamente al titular, así que 6 contratos Devueltos y
 * Retractados salían en una lista llamada "Aprobados" — y además se duplicaban
 * con el Centro, que lista todo lo no aprobado. Un aprobado que después se
 * inactiva no se pierde: sigue entrando por su `aprobacion`.
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
       )
     ORDER BY p."_createdDate" DESC`
  );

  return successResponse({ approvals: result.rows, count: result.rowCount || 0 });
});
