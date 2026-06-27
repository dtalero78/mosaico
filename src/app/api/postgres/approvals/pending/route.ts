import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';

export const GET = handlerWithAuth(async () => {
  // Traer de PEOPLE todos los titulares cuyo campo aprobacion NO sea 'Aprobado'
  const result = await query(
    `SELECT "_id", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
            "numeroId", "contrato", "celular", "email", "plataforma", "tipoUsuario",
            "aprobacion", "hashConsentimiento", "documentacion", "extemporanea",
            "_createdDate", "fechaCreacion"
     FROM "PEOPLE"
     WHERE "tipoUsuario" = 'TITULAR'
       AND ("aprobacion" IS NULL OR "aprobacion" != 'Aprobado')
       AND COALESCE("contrato",'') NOT LIKE 'PRB-%'
     ORDER BY "_createdDate" DESC`
  );

  return successResponse({
    approvals: result.rows,
    count: result.rowCount || 0,
  });
});
