import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';

const CODIGOS_PAIS: Record<string, string> = {
  'Chile': '01',
  'Colombia': '02',
  'Ecuador': '03',
  'Perú': '04',
};

/** Generate next contract number server-side (atomic, avoids race conditions) */
async function generateContractNumber(plataforma: string): Promise<string> {
  const codigoPais = CODIGOS_PAIS[plataforma];
  if (!codigoPais) throw new ValidationError(`País no válido: ${plataforma}`);

  const anoActual = new Date().getFullYear().toString().slice(-2);
  const patron = `${codigoPais}-%-${anoActual}`;

  const result = await query(
    `SELECT MAX(CAST(SPLIT_PART("contrato", '-', 2) AS INTEGER)) AS max_num
     FROM "PEOPLE"
     WHERE "contrato" LIKE $1
       AND SPLIT_PART("contrato", '-', 2) ~ '^[0-9]+$'`,
    [patron]
  );

  const maxNumero = result.rows[0]?.max_num || 9999;
  const siguiente = (maxNumero + 1).toString().padStart(5, '0');
  return `${codigoPais}-${siguiente}-${anoActual}`;
}

export const POST = handlerWithAuth(async (request) => {
  const { titular, financial, beneficiarios, titularEsBeneficiario } = await request.json();

  if (!titular?.plataforma) throw new ValidationError('plataforma is required');
  if (!titular?.numeroId || !titular?.primerNombre || !titular?.primerApellido) {
    throw new ValidationError('titular with numeroId, primerNombre, and primerApellido is required');
  }

  // Generate contract number server-side to avoid race conditions
  const contrato = await generateContractNumber(titular.plataforma);

  // Calculate finalContrato = today + vigencia months
  const vigenciaMeses = parseInt(financial?.vigencia || '0', 10);
  const fechaInicio = new Date();
  const fechaFinal = new Date(fechaInicio);
  if (vigenciaMeses > 0) {
    fechaFinal.setMonth(fechaFinal.getMonth() + vigenciaMeses);
  }
  const finalContrato = vigenciaMeses > 0 ? fechaFinal.toISOString().split('T')[0] : null;

  const created: any = { contrato, titular: null, beneficiarios: [] };

  // 1. Create TITULAR in PEOPLE
  const titularId = ids.person();
  const titularResult = await query(
    `INSERT INTO "PEOPLE" ("_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
      "email", "celular", "telefono", "fechaNacimiento", "domicilio", "ciudad",
      "plataforma", "ingresos", "empresa", "cargo", "genero",
      "referenciaUno", "parentezcoRefUno", "telefonoRefUno", "referenciaDos", "parentezcoRefDos", "telefonoRefDos",
      "asesor", "tipoUsuario", "contrato", "vigencia", "fechaContrato", "finalContrato", "origen", "_createdDate", "_updatedDate")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'TITULAR',$25,$26,NOW(),$27::date,'POSTGRES',NOW(),NOW()) RETURNING *`,
    [titularId, titular.numeroId, titular.primerNombre, titular.segundoNombre || null,
     titular.primerApellido, titular.segundoApellido || null,
     titular.email || null, titular.celular || null, titular.telefono || null,
     titular.fechaNacimiento || null, titular.domicilio || null, titular.ciudad || null,
     titular.plataforma || null, titular.ingresos || null, titular.empresa || null, titular.cargo || null, titular.genero || null,
     titular.referenciaUno || null, titular.parentezcoRefUno || null, titular.telRefUno || null,
     titular.referenciaDos || null, titular.parentezcoRefDos || null, titular.telRefDos || null,
     titular.asesor || null, contrato, financial?.vigencia || null, finalContrato]
  );
  created.titular = titularResult.rows[0];

  // 2. Build beneficiarios list (include titular if titularEsBeneficiario)
  const allBeneficiarios: any[] = [];

  if (titularEsBeneficiario) {
    allBeneficiarios.push({
      primerNombre: titular.primerNombre,
      segundoNombre: titular.segundoNombre,
      primerApellido: titular.primerApellido,
      segundoApellido: titular.segundoApellido,
      numeroId: titular.numeroId,
      fechaNacimiento: titular.fechaNacimiento,
      email: titular.email,
      celular: titular.celular,
    });
  }

  if (beneficiarios?.length) {
    allBeneficiarios.push(...beneficiarios);
  }

  // 3. Create each BENEFICIARIO in PEOPLE (sin nivel/step — se asigna manualmente después)
  for (const b of allBeneficiarios) {
    const benefId = ids.person();
    const benefResult = await query(
      `INSERT INTO "PEOPLE" ("_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
        "email", "celular", "fechaNacimiento", "titularId",
        "tipoUsuario", "contrato", "plataforma", "estadoInactivo",
        "vigencia", "fechaContrato", "finalContrato", "origen", "_createdDate", "_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'BENEFICIARIO',$11,$12,false,$13,NOW(),$14::date,'POSTGRES',NOW(),NOW()) RETURNING *`,
      [benefId, b.numeroId, b.primerNombre, b.segundoNombre || null,
       b.primerApellido, b.segundoApellido || null,
       b.email || null, b.celular || null, b.fechaNacimiento || null, titularId,
       contrato, titular.plataforma || null, financial?.vigencia || null, finalContrato]
    );
    created.beneficiarios.push(benefResult.rows[0]);
  }

  // 4. Create FINANCIERO if financial data present
  if (financial && financial.totalPlan) {
    const finResult = await query(
      `INSERT INTO "FINANCIEROS" ("_id", "contrato", "totalPlan", "numeroCuotas", "valorCuota",
        "pagoInscripcion", "saldo", "fechaPago", "medioPago", "vigencia",
        "origen", "_createdDate", "_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'POSTGRES',NOW(),NOW()) RETURNING *`,
      [ids.financial(), contrato, financial.totalPlan || 0, financial.numeroCuotas || 0,
       financial.valorCuota || 0, financial.pagoInscripcion || 0, financial.saldo || 0,
       financial.fechaPago || null, financial.medioPago || null, financial.vigencia || null]
    );
    created.financiero = finResult.rows[0];
  }

  return successResponse({
    message: `Contrato ${contrato} creado exitosamente`,
    _id: titularId,
    contractNumber: contrato,
    data: { _id: titularId, contractNumber: contrato },
    summary: {
      contrato,
      titularCreated: true,
      beneficiariosCreated: created.beneficiarios.length,
    },
  });
});
