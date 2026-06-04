import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';
import { getAsesorInfo } from '@/lib/asesor';

export const GET = handler(async (_request, { params }) => {
  const titularId = params.id;

  // Load titular (public-safe fields)
  const titular = await queryOne(
    `SELECT "_id", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
            "numeroId", "celular", "email", "plataforma", "contrato", "domicilio", "ciudad",
            "fechaNacimiento", "_createdDate", "asesor",
            "referenciaUno", "parentezcoRefUno", "telefonoRefUno",
            "referenciaDos", "parentezcoRefDos", "telefonoRefDos",
            "observacionesContrato", "consentimientoDeclarativo", "hashConsentimiento",
            "medioPago", "ingresos", "empresa", "cargo"
     FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);

  // Load beneficiarios
  let beneficiarios: any[] = [];
  if (titular.contrato) {
    beneficiarios = await queryMany(
      `SELECT "_id", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
              "numeroId", "celular", "email", "plataforma", "contrato", "domicilio", "ciudad",
              "fechaNacimiento"
       FROM "PEOPLE"
       WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
       ORDER BY "primerNombre" ASC`,
      [titular.contrato]
    );
  }

  // Load financial data
  let financial = null;
  if (titular.contrato) {
    financial = await queryOne(
      `SELECT "totalPlan", "numeroCuotas", "valorCuota", "pagoInscripcion",
              "saldo", "fechaPago", "medioPago", "vigencia"
       FROM "FINANCIEROS" WHERE "contrato" = $1
       ORDER BY "_createdDate" DESC LIMIT 1`,
      [titular.contrato]
    );
  }

  // Load contract template
  let template: string | null = null;
  if (titular.plataforma) {
    let tplRow = await queryOne(
      `SELECT "template" FROM "ContractTemplates" WHERE "plataforma" = $1`,
      [titular.plataforma]
    );
    if (!tplRow) {
      tplRow = await queryOne(
        `SELECT "template" FROM "ContractTemplates" WHERE LOWER("plataforma") = LOWER($1)`,
        [titular.plataforma]
      );
    }
    template = tplRow?.template || null;
  }

  // Resolve asesor info (used at end of consent block in template).
  const asesorInfo = await getAsesorInfo((titular as any).asesor);

  return successResponse({ titular, beneficiarios, financial, template, asesorInfo });
});
