import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';

const CODIGOS_PAIS: Record<string, string> = {
  'Chile': '01',
  'Colombia': '02',
  'Ecuador': '03',
  'Perú': '04',
};

// Primer consecutivo del año/segmento (09000). El siguiente sería 09001, etc.
const BASE_CONSECUTIVO = 9000;

/**
 * GET /api/postgres/contracts/next-number?plataforma=Chile&impulsa=true|false[&prueba=true]
 *
 * Estructura MOSAICO: `<PAIS>-<M5|I6>-NNNNN-YY`
 *  - PAIS: 01 Chile, 02 Colombia, 03 Ecuador, 04 Perú (igual que LGS).
 *  - Segmento: `I6` si es curso Impulsa (checkbox), si no `M5`.
 *  - NNNNN: consecutivo de 5 dígitos con **serie propia por (país + segmento + año)**,
 *    inicia en 09000 y se reinicia al cambiar de año.
 *  - YY: dos dígitos del año.
 *
 * prueba=true → `PRB-<M5|I6>-NNNNN-YY` (serie independiente, no contamina la real).
 */
export const GET = handler(async (request) => {
  const { searchParams } = new URL(request.url);
  const plataforma = searchParams.get('plataforma');
  const esPrueba   = searchParams.get('prueba') === 'true';
  const esImpulsa  = searchParams.get('impulsa') === 'true';

  const anoActual = new Date().getFullYear().toString().slice(-2);
  const segmento  = esImpulsa ? 'I6' : 'M5';

  const prefijo = esPrueba ? 'PRB' : CODIGOS_PAIS[plataforma || ''];
  if (!esPrueba && !plataforma) throw new ValidationError('plataforma is required');
  if (!prefijo) throw new ValidationError(`País no válido: ${plataforma}. Válidos: ${Object.keys(CODIGOS_PAIS).join(', ')}`);

  // Serie por (prefijo + segmento + año); el consecutivo está en la posición 3.
  const patron = `${prefijo}-${segmento}-%-${anoActual}`;
  const result = await query(
    `SELECT MAX(CAST(SPLIT_PART("contrato", '-', 3) AS INTEGER)) AS max_num
     FROM "PEOPLE"
     WHERE "contrato" LIKE $1
       AND SPLIT_PART("contrato", '-', 3) ~ '^[0-9]+$'`,
    [patron]
  );

  const maxNumero = result.rows[0]?.max_num;
  const siguienteNum = maxNumero ? maxNumero + 1 : BASE_CONSECUTIVO;
  const siguiente = siguienteNum.toString().padStart(5, '0');
  const contrato = `${prefijo}-${segmento}-${siguiente}-${anoActual}`;

  return successResponse({ contrato, codigoPais: prefijo, segmento, siguiente, ano: anoActual, esPrueba, esImpulsa });
});
