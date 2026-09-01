import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

export const GET = handlerWithAuth(async () => {
  // Titulares cuyo contrato NO está aprobado.
  //
  // La lista de estados es el complemento EXACTO del endpoint `aprobados`: antes
  // sólo se descartaba 'Aprobado' literal, así que un registro grabado como
  // 'Aprobada' o marcado 'FINALIZADA' por el cron se habría colado aquí Y en
  // Aprobados a la vez. Hoy no hay ninguno; la guarda evita que aparezca.
  const result = await query(
    `SELECT p."_id", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."numeroId", p."contrato", p."celular", p."email", p."plataforma", p."tipoUsuario",
            p."aprobacion", p."hashConsentimiento", p."documentacion", p."extemporanea",
            p."listoAprobacion",
            -- Aprobar exige que Comercial haya dejado el contrato listo (ahí se
            -- toma el cupo del salón). Se expone para que el Centro lo avise
            -- antes de intentar la aprobación y no sólo al chocar con el error.
            COALESCE(p."gestionContratoListo", false) AS "gestionContratoListo",
            p."_createdDate", p."fechaCreacion",
            camp."campaign"
     FROM "PEOPLE" p
     LEFT JOIN LATERAL (
       SELECT "campaign" FROM "PEOPLE"
       WHERE "contrato" = p."contrato" AND "tipoUsuario" = 'BENEFICIARIO' AND "campaign" IS NOT NULL
       LIMIT 1
     ) camp ON true
     WHERE p."tipoUsuario" = 'TITULAR'
       AND (p."aprobacion" IS NULL
            OR p."aprobacion" NOT IN ('Aprobado','Aprobada','FINALIZADA'))
       AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
     ORDER BY p."_createdDate" DESC`
  );

  return successResponse({
    approvals: result.rows,
    count: result.rowCount || 0,
  });
});
