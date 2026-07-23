import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryOne } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';

/**
 * POST /api/postgres/people/[id]/listo-aprobacion
 *
 * Botón amarillo "Contrato Para Aprobación" del detalle del contrato: marca el
 * contrato del TITULAR como LISTO para el Centro de Aprobación (que filtra por
 * este estado por defecto). Guarda cuándo y quién lo marcó. Idempotente: si ya
 * estaba en LISTO, conserva la marca original.
 */
export const POST = handlerWithAuth(async (_request, { params }, session) => {
  const titular = await queryOne<{ _id: string; tipoUsuario: string; aprobacion: string | null; listoAprobacion: string | null; contrato: string | null }>(
    `SELECT "_id", "tipoUsuario", "aprobacion", "listoAprobacion"::text, "contrato" FROM "PEOPLE" WHERE "_id" = $1`,
    [params.id]
  );
  if (!titular) throw new NotFoundError('Titular', params.id);
  if (titular.tipoUsuario !== 'TITULAR') {
    throw new ValidationError('Solo el TITULAR del contrato puede marcarse como listo para aprobación');
  }
  if (titular.aprobacion === 'Aprobado' || titular.aprobacion === 'Aprobada') {
    throw new ValidationError('El contrato ya está aprobado');
  }

  if (!titular.listoAprobacion) {
    await queryOne(
      `UPDATE "PEOPLE"
          SET "listoAprobacion" = NOW(),
              "listoAprobacionPor" = $2,
              "_updatedDate" = NOW()
        WHERE "_id" = $1
        RETURNING "_id"`,
      [params.id, session?.user?.email || 'desconocido']
    );
  }

  return successResponse({
    message: 'Contrato marcado como LISTO para aprobación',
    contrato: titular.contrato,
    yaEstabaListo: !!titular.listoAprobacion,
  });
});
