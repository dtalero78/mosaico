import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { getSessionComercialScope } from '@/lib/crm';

/**
 * GET /api/postgres/matriculas
 *
 * Comercial › Matrículas (traída de LGS): TODOS los contratos (una fila por
 * titular) con un campo calculado `categoria` para filtrar en el cliente.
 *
 * Categorías — las de LGS, con los estados propios de MOSAICO:
 *   Aprobados · Finalizado · Devuelto · Rechazado · Retractado · Contrato nulo ·
 *   Pendiente · Sin firmar · Firmado sin aprobar · Listo para aprobar
 * "Listo para aprobar" no existe en LGS: es el firmado que Comercial ya dejó listo
 * (`gestionContratoListo`, cupo tomado), que es lo que la aprobación exige.
 *
 * La campaña y el curso viven en los BENEFICIARIOS, así que se agregan por contrato.
 * Excluye PRB-. Alcance por líder: el mismo de Gestión Contrato.
 */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, ComercialPermission.MATRICULAS_VER);

  const scope = await getSessionComercialScope(session);
  const params: any[] = [];
  let scopeSql = '';
  if (!scope.seeAll) {
    params.push(scope.liderCorreo);
    scopeSql = ` AND LOWER(p."liderComercialCorreo") = LOWER($1)`;
  }

  const result = await query(
    `SELECT p."_id", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."numeroId", p."contrato", p."celular", p."email", p."plataforma",
            p."aprobacion", p."estado", p."estadoInactivo",
            (COALESCE(p."hashConsentimiento",'') <> '') AS "firmado",
            COALESCE(p."gestionContratoListo", false) AS "listo",
            p."asesor", p."liderComercial", p."_createdDate",
            COALESCE(p."fechaContrato", p."inicioContrato", p."_createdDate"::date)::text AS "fechaContrato",
            p."finalContrato"::text AS "finalContrato",
            COALESCE(bc."n", 0) AS "numBeneficiarios",
            bc."campanias", bc."cursos",
            CASE
              WHEN LOWER(TRIM(COALESCE(p."aprobacion",''))) IN ('aprobado','aprobada') THEN 'Aprobados'
              WHEN UPPER(TRIM(COALESCE(p."aprobacion",''))) = 'FINALIZADA' OR p."estado" = 'FINALIZADA' THEN 'Finalizado'
              WHEN TRIM(COALESCE(p."aprobacion",'')) = '' AND COALESCE(p."hashConsentimiento",'') = '' THEN 'Sin firmar'
              WHEN TRIM(COALESCE(p."aprobacion",'')) = '' AND p."gestionContratoListo" IS TRUE THEN 'Listo para aprobar'
              WHEN TRIM(COALESCE(p."aprobacion",'')) = '' THEN 'Firmado sin aprobar'
              ELSE TRIM(p."aprobacion")
            END AS "categoria"
       FROM "PEOPLE" p
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS "n",
                STRING_AGG(DISTINCT b."campaign", ', ') AS "campanias",
                STRING_AGG(DISTINCT UPPER(b."tipoCurso"), ', ') AS "cursos"
           FROM "PEOPLE" b
          WHERE b."contrato" = p."contrato" AND b."tipoUsuario" <> 'TITULAR'
       ) bc ON true
      WHERE p."tipoUsuario" = 'TITULAR'
        AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'${scopeSql}
      ORDER BY p."_createdDate" DESC`,
    params
  );

  return successResponse({ matriculas: result.rows, count: result.rowCount || 0 });
});
