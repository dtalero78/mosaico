import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/approvals/aprobados[?vista=sin-aprobar]
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
 *
 * `vista=sin-aprobar` cambia el UNIVERSO (no filtra el anterior): los contratos
 * FIRMADOS que nadie aprobó, en el estado que sea — Devuelto, Retractado,
 * Contrato nulo, Pendiente o sin decisión. La firma es la misma condición que
 * usa Gestión Contrato (`hashConsentimiento`), así que las dos pantallas hablan
 * del mismo conjunto. Los finalizados quedan fuera: ya están en la vista normal.
 */
const APROBADO_O_FINALIZADO = `(
  p."aprobacion" IN ('Aprobado','Aprobada','FINALIZADA')
  OR p."estado" = 'FINALIZADA'
)`;

const FIRMADO = `p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> ''`;

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.APROBADOS_VER);

  const sinAprobar = new URL(req.url).searchParams.get('vista') === 'sin-aprobar';
  const universo = sinAprobar
    ? `${FIRMADO} AND NOT ${APROBADO_O_FINALIZADO}`
    : APROBADO_O_FINALIZADO;

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
       AND (${universo})
     ORDER BY p."_createdDate" DESC`
  );

  return successResponse({ approvals: result.rows, count: result.rowCount || 0 });
});
