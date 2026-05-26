import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError, ConflictError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';

const VALID_PLAN = ['Contado', 'Credito', 'Colaborador'] as const;
type Plan = typeof VALID_PLAN[number];
function normalizePlan(v: any): Plan | null {
  if (!v) return null;
  const s = String(v).trim();
  return (VALID_PLAN as readonly string[]).includes(s) ? (s as Plan) : null;
}

export const POST = handlerWithAuth(async (request) => {
  const { contrato, titular, financial, beneficiarios, titularEsBeneficiario } = await request.json();

  // Plan (Contado/Credito/Colaborador) — se valida y propaga a PEOPLE (titular +
  // beneficiarios) y FINANCIEROS. Mismo patrón que /api/postgres/contracts.
  const plan = normalizePlan(financial?.plan);
  if (financial?.plan && !plan) {
    throw new ValidationError(`plan debe ser uno de: ${VALID_PLAN.join(', ')}`);
  }

  if (!contrato?.trim()) throw new ValidationError('El número de contrato es requerido');
  if (!titular?.plataforma) throw new ValidationError('plataforma es requerida');
  if (!titular?.numeroId || !titular?.primerNombre || !titular?.primerApellido) {
    throw new ValidationError('numeroId, primerNombre y primerApellido del titular son requeridos');
  }

  // Verificar que el número de contrato no exista ya
  const existing = await queryOne(
    `SELECT "_id" FROM "PEOPLE" WHERE "contrato" = $1 LIMIT 1`,
    [contrato.trim()]
  );
  if (existing) throw new ConflictError(`Ya existe un contrato con el número "${contrato}"`);

  // Calcular finalContrato a partir de vigencia si no viene explícito
  let finalContrato = financial?.finalContrato || null;
  if (!finalContrato && financial?.vigencia) {
    const vigenciaMeses = parseInt(financial.vigencia, 10);
    if (vigenciaMeses > 0) {
      const base = financial.fechaContrato ? new Date(financial.fechaContrato) : new Date();
      base.setMonth(base.getMonth() + vigenciaMeses);
      finalContrato = base.toISOString().split('T')[0];
    }
  }

  const contratoTrimmed = contrato.trim();
  const titularId = ids.person();

  // 1. Crear TITULAR en PEOPLE
  await query(
    `INSERT INTO "PEOPLE" (
      "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
      "email", "celular", "telefono", "fechaNacimiento", "domicilio", "ciudad",
      "plataforma", "ingresos", "empresa", "cargo", "genero",
      "referenciaUno", "parentezcoRefUno", "telefonoRefUno",
      "referenciaDos", "parentezcoRefDos", "telefonoRefDos",
      "asesor", "medioPago", "tipoUsuario", "contrato",
      "vigencia", "fechaContrato", "finalContrato", "plan",
      "aprobacion", "estadoInactivo", "origen", "_createdDate", "_updatedDate"
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,$22,$23,$24,$25,
      'TITULAR',$26,$27,$28,$29::date,$30,
      'Pendiente',false,'POSTGRES',NOW(),NOW()
    )`,
    [
      titularId,
      titular.numeroId,
      titular.primerNombre,
      titular.segundoNombre || null,
      titular.primerApellido,
      titular.segundoApellido || null,
      titular.email || null,
      titular.celular || null,
      titular.telefono || null,
      titular.fechaNacimiento || null,
      titular.domicilio || null,
      titular.ciudad || null,
      titular.plataforma,
      titular.ingresos || null,
      titular.empresa || null,
      titular.cargo || null,
      titular.genero || null,
      titular.referenciaUno || null,
      titular.parentezcoRefUno || null,
      titular.telRefUno || null,
      titular.referenciaDos || null,
      titular.parentezcoRefDos || null,
      titular.telRefDos || null,
      titular.asesor || null,
      financial?.medioPago || null,
      contratoTrimmed,
      financial?.vigencia || null,
      financial?.fechaContrato || null,
      finalContrato,
      plan,
    ]
  );

  // 2. Construir lista de beneficiarios
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
      domicilio: titular.domicilio,
      ciudad: titular.ciudad,
    });
  }

  if (Array.isArray(beneficiarios) && beneficiarios.length > 0) {
    allBeneficiarios.push(...beneficiarios);
  }

  // 3. Crear cada BENEFICIARIO en PEOPLE
  const beneficiariosCreados: string[] = [];
  for (const b of allBeneficiarios) {
    const benefId = ids.person();
    await query(
      `INSERT INTO "PEOPLE" (
        "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
        "email", "celular", "fechaNacimiento", "domicilio", "ciudad",
        "titularId", "tipoUsuario", "contrato", "plataforma",
        "vigencia", "fechaContrato", "finalContrato", "plan",
        "aprobacion", "estadoInactivo", "origen", "_createdDate", "_updatedDate"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,'BENEFICIARIO',$13,$14,
        $15,$16,$17::date,$18,
        'Pendiente',false,'POSTGRES',NOW(),NOW()
      )`,
      [
        benefId,
        b.numeroId,
        b.primerNombre,
        b.segundoNombre || null,
        b.primerApellido,
        b.segundoApellido || null,
        b.email || null,
        b.celular || null,
        b.fechaNacimiento || null,
        b.domicilio || null,
        b.ciudad || null,
        titularId,
        contratoTrimmed,
        titular.plataforma,
        financial?.vigencia || null,
        financial?.fechaContrato || null,
        finalContrato,
        plan,
      ]
    );
    beneficiariosCreados.push(benefId);
  }

  // 4. Crear registro FINANCIERO si hay datos financieros
  if (financial?.totalPlan) {
    await query(
      `INSERT INTO "FINANCIEROS" (
        "_id", "contrato", "totalPlan", "numeroCuotas", "valorCuota",
        "pagoInscripcion", "saldo", "fechaPago", "medioPago", "vigencia", "plan",
        "origen", "_createdDate", "_updatedDate"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'POSTGRES',NOW(),NOW())`,
      [
        ids.financial(),
        contratoTrimmed,
        financial.totalPlan || 0,
        financial.numeroCuotas || 0,
        financial.valorCuota || 0,
        financial.pagoInscripcion || 0,
        financial.saldo || 0,
        financial.fechaPago || null,
        financial.medioPago || null,
        financial.vigencia || null,
        plan,
      ]
    );
  }

  return successResponse({
    message: `Contrato ${contratoTrimmed} migrado exitosamente`,
    titularId,
    contrato: contratoTrimmed,
    beneficiariosCreados: beneficiariosCreados.length,
  });
});
