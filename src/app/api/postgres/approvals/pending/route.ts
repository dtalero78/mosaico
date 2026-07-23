import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

export const GET = handlerWithAuth(async () => {
  // Traer de PEOPLE todos los titulares cuyo campo aprobacion NO sea 'Aprobado'
  const result = await query(
    `SELECT p."_id", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."numeroId", p."contrato", p."celular", p."email", p."plataforma", p."tipoUsuario",
            p."aprobacion", p."hashConsentimiento", p."documentacion", p."extemporanea",
            p."listoAprobacion",
            p."_createdDate", p."fechaCreacion",
            camp."campaign"
     FROM "PEOPLE" p
     LEFT JOIN LATERAL (
       SELECT "campaign" FROM "PEOPLE"
       WHERE "contrato" = p."contrato" AND "tipoUsuario" = 'BENEFICIARIO' AND "campaign" IS NOT NULL
       LIMIT 1
     ) camp ON true
     WHERE p."tipoUsuario" = 'TITULAR'
       AND (p."aprobacion" IS NULL OR p."aprobacion" != 'Aprobado')
       AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
     ORDER BY p."_createdDate" DESC`
  );

  return successResponse({
    approvals: result.rows,
    count: result.rowCount || 0,
  });
});
