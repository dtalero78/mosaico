import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { createFullContract, normalizeTipoPlan, validarNumeroIds, buscarTitularExistente } from '@/services/contract-creation.service';

const CODIGOS_PAIS: Record<string, string> = {
  'Chile': '01',
  'Colombia': '02',
  'Ecuador': '03',
  'Perú': '04',
};

// Primer consecutivo del año/segmento (09000). El siguiente sería 09001, etc.
const BASE_CONSECUTIVO = 9000;

/**
 * Número de contrato MOSAICO: `<PAIS|PRB>-<M5|I6>-NNNNN-YY`.
 * Segmento I6 si es curso Impulsa, si no M5. Serie propia por
 * (prefijo + segmento + año); inicia en 09000 y reinicia por año.
 */
async function generateContractNumber(plataforma: string, esPrueba: boolean, esImpulsa: boolean): Promise<string> {
  const anoActual = new Date().getFullYear().toString().slice(-2);
  const segmento  = esImpulsa ? 'I6' : 'M5';
  const prefijo   = esPrueba ? 'PRB' : CODIGOS_PAIS[plataforma];
  if (!prefijo) throw new ValidationError(`País no válido: ${plataforma}`);

  const patron = `${prefijo}-${segmento}-%-${anoActual}`;
  const result = await query(
    `SELECT MAX(CAST(SPLIT_PART("contrato", '-', 3) AS INTEGER)) AS max_num
     FROM "PEOPLE"
     WHERE "contrato" LIKE $1
       AND SPLIT_PART("contrato", '-', 3) ~ '^[0-9]+$'`,
    [patron]
  );
  const maxNumero = result.rows[0]?.max_num;
  const siguiente = (maxNumero ? maxNumero + 1 : BASE_CONSECUTIVO).toString().padStart(5, '0');
  return `${prefijo}-${segmento}-${siguiente}-${anoActual}`;
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const { titular, financial, beneficiarios, titularEsBeneficiario, clientToday, esContratoPrueba, permitirTitularDuplicado } = await request.json();
  const esPrueba = esContratoPrueba === true;

  // Plataforma sólo es obligatoria para contratos REALES; en pruebas se permite sin plataforma.
  if (!esPrueba && !titular?.plataforma) throw new ValidationError('plataforma is required');
  if (!titular?.numeroId || !titular?.primerNombre || !titular?.primerApellido) {
    throw new ValidationError('titular with numeroId, primerNombre, and primerApellido is required');
  }

  // tipoPlan (Contado / Credito / Colaborador) — se valida y propaga a 3 tablas
  const tipoPlan = normalizeTipoPlan(financial?.tipoPlan);
  if (financial?.tipoPlan && !tipoPlan) {
    throw new ValidationError('tipoPlan debe ser uno de: Contado, Credito, Colaborador');
  }

  // Regla MOSAICO: el numeroId SOLO puede compartirse en el caso
  // "titular es beneficiario" (fila TITULAR + fila BENEFICIARIO generada
  // server-side a partir del titular). Cualquier otro numeroId duplicado —
  // repetido en el formulario o ya existente en PEOPLE — se rechaza.
  await validarNumeroIds(titular, beneficiarios);

  // El titular PUEDE tener varios contratos: si su numeroId ya existe y el usuario
  // no lo ha confirmado, se devuelve `needsConfirmation` (sin crear) para mostrar el
  // modal de advertencia. Al confirmar, el front reenvía con permitirTitularDuplicado=true.
  if (permitirTitularDuplicado !== true) {
    const titularExistente = await buscarTitularExistente(titular.numeroId);
    if (titularExistente) {
      return successResponse({ needsConfirmation: true, titularExistente });
    }
  }

  // Generate contract number server-side to avoid race conditions.
  const contrato = await generateContractNumber(titular.plataforma, esPrueba, titular?.esCursoImpulsa === true);

  const created = await createFullContract({
    contrato,
    titular,
    financial,
    beneficiarios: beneficiarios || [],
    titularEsBeneficiario: titularEsBeneficiario === true,
    tipoPlan,
    createdBy: (session.user as any)?.email || 'unknown',
    clientToday,
    // Sólo el flujo comercial respeta el corte de matrícula (lunes 09:00 de Chile).
    // El wizard ya filtra los cursos, pero lo hace al cargar la página.
    exigirMatriculaAbierta: true,
  });

  return successResponse({
    message: `Contrato ${contrato} creado exitosamente`,
    _id: created.titularId,
    contractNumber: contrato,
    data: { _id: created.titularId, contractNumber: contrato },
    summary: {
      contrato,
      titularCreated: true,
      beneficiariosCreated: created.beneficiarios.length,
    },
  });
});
