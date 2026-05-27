import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';

/**
 * POST /api/postgres/people/[id]/marca-opcional
 *
 * Toggle simple de PEOPLE.marcaOpcional entre 'OPC' y NULL. Alimentación
 * manual del área de recaudos para destacar titulares en la columna
 * "Opcional" de /dashboard/recaudos/asignacion.
 *
 * Body (opcional): `{ valor: 'OPC' | null }` — si se omite se hace toggle:
 *   - si actual = NULL → pasa a 'OPC'
 *   - si actual = 'OPC' → pasa a NULL
 *
 * Gate: `PERSON.FINANCIERA.MARCAR_OPCIONAL` (SUPER_ADMIN / ADMIN bypass).
 * Sin motivo ni auditoría — es una marca operativa, no decisión auditable.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, PersonPermission.MARCAR_OPCIONAL);

  const body = await request.json().catch(() => ({}));
  const existing = await queryOne<{ marcaOpcional: string | null }>(
    `SELECT "marcaOpcional" FROM "PEOPLE" WHERE "_id" = $1`,
    [params.id],
  );
  if (!existing) throw new NotFoundError('PEOPLE', params.id);

  // Si el cliente manda `valor` explícito lo respetamos (normalizando), si no
  // hacemos toggle entre 'OPC' y null.
  let nuevoValor: string | null;
  if (body && Object.prototype.hasOwnProperty.call(body, 'valor')) {
    const v = typeof body.valor === 'string' ? body.valor.trim().toUpperCase() : null;
    nuevoValor = v === 'OPC' ? 'OPC' : null;
  } else {
    nuevoValor = existing.marcaOpcional === 'OPC' ? null : 'OPC';
  }

  await queryOne(
    `UPDATE "PEOPLE" SET "marcaOpcional" = $1, "_updatedDate" = NOW() WHERE "_id" = $2 RETURNING "_id"`,
    [nuevoValor, params.id],
  );

  return successResponse({ marcaOpcional: nuevoValor });
});
