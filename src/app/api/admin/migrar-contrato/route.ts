import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryOne } from '@/lib/postgres';
import { ValidationError, ConflictError } from '@/lib/errors';
import { createFullContract, normalizeTipoPlan, validarNumeroIds } from '@/services/contract-creation.service';

/**
 * POST /api/admin/migrar-contrato
 *
 * Migrar Contrato usa la MISMA lógica de creación que Crear Contrato
 * (createFullContract): PEOPLE titular + beneficiarios, ACADEMICA en el curso
 * puente WELCOME (inactiva), USUARIOS_ROLES con login bloqueado, cupos,
 * FINANCIEROS y PAGOS_TITULARES cuota#0. La ÚNICA diferencia es que el número
 * de contrato se DIGITA manualmente (aquí) en vez de auto-generarse.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const { contrato, titular, financial, beneficiarios, titularEsBeneficiario } = await request.json();

  // Número de contrato manual — requerido y único.
  if (!contrato?.trim()) throw new ValidationError('El número de contrato es requerido');
  const contratoTrimmed = contrato.trim();
  const existing = await queryOne(
    `SELECT "_id" FROM "PEOPLE" WHERE "contrato" = $1 LIMIT 1`,
    [contratoTrimmed]
  );
  if (existing) throw new ConflictError(`Ya existe un contrato con el número "${contratoTrimmed}"`);

  if (!titular?.plataforma) throw new ValidationError('plataforma es requerida');
  if (!titular?.numeroId || !titular?.primerNombre || !titular?.primerApellido) {
    throw new ValidationError('numeroId, primerNombre y primerApellido del titular son requeridos');
  }

  const tipoPlan = normalizeTipoPlan(financial?.tipoPlan ?? financial?.plan);
  if ((financial?.tipoPlan ?? financial?.plan) && !tipoPlan) {
    throw new ValidationError('plan debe ser uno de: Contado, Credito, Colaborador');
  }

  // Regla numeroId (misma que Crear Contrato).
  await validarNumeroIds(titular, beneficiarios || []);

  const created = await createFullContract({
    contrato: contratoTrimmed,
    titular,
    financial,
    beneficiarios: beneficiarios || [],
    titularEsBeneficiario: titularEsBeneficiario === true,
    tipoPlan,
    createdBy: (session?.user as any)?.email || 'unknown',
    clientToday: financial?.clientToday || null,
  });

  return successResponse({
    message: `Contrato ${contratoTrimmed} migrado exitosamente`,
    titularId: created.titularId,
    contrato: contratoTrimmed,
    beneficiariosCreados: created.beneficiarios.length,
  });
});
