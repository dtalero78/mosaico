import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { estadosDeCampanas, campanasActuales } from '@/lib/cursos-campaign';

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
 *
 * **La campaña vive en el ALUMNO, no en el titular**, y soltar el cupo le borra
 * el curso al alumno. Un contrato devuelto o retractado queda entonces sin
 * campaña y desaparece de cualquier filtro por campaña. Para esos se devuelve
 * `campaignAnterior`: la campaña de la que salió, tomada de `cupoHistory`. Si
 * tampoco hay historial, el contrato queda sin campaña — el dato no existe.
 *
 * `campanias` es el catálogo completo (la más reciente primero) con el estado de
 * cada campaña: el desplegable no se arma con las filas de la vista, que en "Sin
 * aprobar" son un puñado y dejaban fuera casi todas las campañas.
 *
 * `recientes` son las campañas de la pestaña Recientes: la que está en
 * matrícula más la activa más reciente — la misma regla con la que abre la
 * bandeja de Welcome (`campanasActuales`). La pestaña Global no acota.
 */
// Con COALESCE a propósito: la vista "sin aprobar" NIEGA esta condición, y con
// `aprobacion` en NULL (el contrato sin decisión) la negación daba NULL en vez
// de verdadero — 144 contratos firmados y sin decidir quedaban fuera de la vista
// hecha justamente para ellos. Sólo aparecían los Devueltos y Retractados.
const APROBADO_O_FINALIZADO = `(
  COALESCE(p."aprobacion", '') IN ('Aprobado','Aprobada','FINALIZADA')
  OR COALESCE(p."estado", '') = 'FINALIZADA'
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
            camp."campaign", ant."campaign" AS "campaignAnterior"
     FROM "PEOPLE" p
     LEFT JOIN LATERAL (
       SELECT "campaign" FROM "PEOPLE"
       WHERE "contrato" = p."contrato" AND "tipoUsuario" = 'BENEFICIARIO' AND "campaign" IS NOT NULL
       LIMIT 1
     ) camp ON true
     LEFT JOIN LATERAL (
       SELECT h->>'campaign' AS "campaign"
       FROM "PEOPLE" b,
            LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(b."cupoHistory") = 'array' THEN b."cupoHistory" ELSE '[]'::jsonb END
            ) h
       WHERE camp."campaign" IS NULL
         AND b."contrato" = p."contrato" AND b."tipoUsuario" = 'BENEFICIARIO'
         AND COALESCE(h->>'campaign', '') <> ''
       ORDER BY h->>'fecha' DESC
       LIMIT 1
     ) ant ON true
     WHERE p."tipoUsuario" = 'TITULAR'
       AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
       AND (${universo})
     ORDER BY p."_createdDate" DESC`
  );

  const cursos = await query(
    `SELECT "campaign", "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso"
     FROM "CURSOS_CAMPAIGN"
     WHERE COALESCE("campaign", '') <> ''`
  );
  const campanias = estadosDeCampanas(cursos.rows)
    .sort((a, b) => String(b.inicio || '').localeCompare(String(a.inicio || '')) || a.campaign.localeCompare(b.campaign));

  return successResponse({
    approvals: result.rows,
    count: result.rowCount || 0,
    campanias,
    recientes: campanasActuales(cursos.rows),
  });
});
