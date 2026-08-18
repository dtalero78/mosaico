import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';

const ALLOWED_FIELDS = [
  'numeroId', 'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
  'tipoUsuario', 'email', 'celular', 'ciudad', 'domicilio',
  'contrato', 'plataforma', 'nivel', 'step',
  'fechaNacimiento', 'inicioContrato', 'finalContrato',
];

// Map CSV field names to DB column names
const FIELD_MAP: Record<string, string> = {
  pais: 'plataforma',
  direccion: 'domicilio',
};

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.SUBIR_LOTE);
  const body = await request.json();
  const registros = body.registros;

  if (!Array.isArray(registros) || registros.length === 0) {
    throw new ValidationError('No hay registros para importar');
  }

  if (registros.length > 5000) {
    throw new ValidationError('Máximo 5000 registros por lote');
  }

  let exitosos = 0;
  let fallidos = 0;
  const errores: string[] = [];

  for (const reg of registros) {
    try {
      if (!reg.numeroId || !reg.primerNombre || !reg.primerApellido) {
        errores.push(`Fila ${reg.fila || '?'}: Faltan campos obligatorios (numeroId, primerNombre, primerApellido)`);
        fallidos++;
        continue;
      }

      // Remap CSV field names to DB column names
      for (const [from, to] of Object.entries(FIELD_MAP)) {
        if (reg[from] !== undefined) {
          if (!reg[to]) reg[to] = reg[from];
          delete reg[from];
        }
      }

      const tipoUsuario = reg.tipoUsuario || 'BENEFICIARIO';

      // Check if record exists by numeroId + tipoUsuario
      const existing = await queryOne(
        `SELECT "_id" FROM "PEOPLE" WHERE "numeroId" = $1 AND "tipoUsuario" = $2`,
        [reg.numeroId, tipoUsuario]
      );

      if (existing) {
        // UPDATE existing record
        const setClauses: string[] = [];
        const values: any[] = [];
        let paramIdx = 1;

        for (const field of ALLOWED_FIELDS) {
          if (field === 'numeroId') continue;
          const val = reg[field];
          if (val !== undefined && val !== null && val !== '') {
            setClauses.push(`"${field}" = $${paramIdx}`);
            values.push(val);
            paramIdx++;
          }
        }

        if (setClauses.length > 0) {
          setClauses.push(`"_updatedDate" = NOW()`);
          values.push(existing._id);
          await query(
            `UPDATE "PEOPLE" SET ${setClauses.join(', ')} WHERE "_id" = $${paramIdx}`,
            values
          );
        }
      } else {
        // INSERT new record
        const _id = ids.person();
        const fields: string[] = ['"_id"', '"fechaCreacion"', '"_createdDate"', '"_updatedDate"'];
        const placeholders: string[] = ['$1', 'NOW()', 'NOW()', 'NOW()'];
        const values: any[] = [_id];
        let paramIdx = 2;

        for (const field of ALLOWED_FIELDS) {
          const val = reg[field];
          if (val !== undefined && val !== null && val !== '') {
            fields.push(`"${field}"`);
            placeholders.push(`$${paramIdx}`);
            values.push(val);
            paramIdx++;
          }
        }

        await query(
          `INSERT INTO "PEOPLE" (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
          values
        );
      }

      exitosos++;
    } catch (err: any) {
      errores.push(`Fila ${reg.fila || '?'}: ${err.message}`);
      fallidos++;
    }
  }

  return successResponse({
    exitosos,
    fallidos,
    total: registros.length,
    errores,
  });
});
