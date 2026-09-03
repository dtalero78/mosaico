import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';

/**
 * Deja constancia de las acciones de cierre del contrato.
 *
 * El checklist "Antes de cerrar" mostraba "Pendiente" en cosas que sí se habían
 * hecho, porque esas marcas vivían sólo en el estado del navegador y volvían a
 * cero al recargar. Ni la solicitud de firma ni el envío del PDF dejaban rastro
 * en la base, así que al reabrir el contrato el dato no existía.
 *
 * Se registra el INSTANTE, no un booleano: saber *cuándo* se envió el contrato
 * es lo que sirve cuando alguien pregunta por qué el titular no ha firmado.
 *
 * Sólo se escribe la primera vez (COALESCE): el valor guardado es cuándo se hizo
 * por primera vez, no cuándo se repitió.
 */
const CAMPOS: Record<string, string> = {
  firma:   'firmaSolicitadaEn',
  pdf:     'pdfEnviadoEn',
  impreso: 'contratoImpresoEn',
};

export const POST = handlerWithAuth(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const tipo = String(body?.tipo || '').trim();

  const columna = CAMPOS[tipo];
  if (!columna) {
    throw new ValidationError(`tipo debe ser uno de: ${Object.keys(CAMPOS).join(', ')}`);
  }

  const persona = await queryOne<{ _id: string }>(
    'SELECT "_id" FROM "PEOPLE" WHERE "_id" = $1',
    [params.id]
  );
  if (!persona) throw new NotFoundError('Titular', params.id);

  // `rehacer` fuerza la actualización del instante (p.ej. un reenvío que sí
  // interesa fechar). Por defecto se conserva el primero.
  const set = body?.rehacer === true
    ? `"${columna}" = NOW()`
    : `"${columna}" = COALESCE("${columna}", NOW())`;

  const res = await query<Record<string, string | null>>(
    `UPDATE "PEOPLE" SET ${set} WHERE "_id" = $1 RETURNING "${columna}"`,
    [params.id]
  );

  return successResponse({ tipo, [columna]: res.rows[0]?.[columna] ?? null });
});
