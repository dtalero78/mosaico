import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { registrarCambioAprobacion, nombreDe } from '@/lib/aprobacion-audit';
import { exigeComentarioEstado, comentarioValido, mensajeComentarioEstado } from '@/lib/comentario-aprobacion';

export const GET = handlerWithAuth(async (request, { params }) => {
  const result = await query(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [params.id]
  );
  if (result.rowCount === 0) throw new NotFoundError('Person');
  return successResponse({ approval: result.rows[0] });
});

// Mapeo aprobacion → estado operativo del contrato
const APROBACION_TO_ESTADO: Record<string, string> = {
  'Aprobado':       'ACTIVA',
  'Pendiente':      'PENDIENTE',
  'Retractado':     'RETRACTADO',
  'Contrato nulo':  'ANULADO',
  'Devuelto':       'ANULADO',
  'Rechazado':      'ANULADO',
};

export const PUT = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AprobacionPermission.ACTUALIZAR);
  const body = await request.json();
  const { estado } = body || {};
  if (!estado) throw new ValidationError('estado is required');

  const validEstados = ['Aprobado', 'Rechazado', 'Pendiente', 'Contrato nulo', 'Devuelto', 'Retractado'];
  // Accept both uppercase API format and display format
  const estadoMap: Record<string, string> = {
    'APROBADO': 'Aprobado',
    'RECHAZADO': 'Rechazado',
    'PENDIENTE': 'Pendiente',
    'RETRACTADO': 'Retractado',
  };
  const estadoFinal = estadoMap[estado] || estado;

  if (!validEstados.includes(estadoFinal)) {
    throw new ValidationError(`estado must be one of: ${validEstados.join(', ')}`);
  }

  const check = await query(`SELECT "_id", "aprobacion", "contrato", "tipoUsuario", "primerNombre", "primerApellido" FROM "PEOPLE" WHERE "_id" = $1`, [params.id]);
  if (check.rowCount === 0) throw new NotFoundError('Person');
  const antes = check.rows[0];

  // Comentario obligatorio salvo al aprobar el contrato (lib/comentario-aprobacion).
  const motivo = String(body?.motivo ?? '').trim() || null;
  if ((antes.aprobacion || null) !== estadoFinal
      && exigeComentarioEstado(estadoFinal, antes.tipoUsuario) && !comentarioValido(motivo)) {
    throw new ValidationError(mensajeComentarioEstado(estadoFinal));
  }

  const estadoOperativo = APROBACION_TO_ESTADO[estadoFinal] ?? null;

  const result = await query(
    `UPDATE "PEOPLE"
     SET "aprobacion" = $1,
         "estado" = COALESCE($2, "estado"),
         "_updatedDate" = NOW()
     WHERE "_id" = $3 RETURNING *`,
    [estadoFinal, estadoOperativo, params.id]
  );

  await registrarCambioAprobacion({
    personId: params.id, contrato: antes.contrato, tipoUsuario: antes.tipoUsuario, nombre: nombreDe(antes),
    estadoAnterior: antes.aprobacion, estadoNuevo: estadoFinal, origen: 'PANTALLA_APROBACION', motivo, session,
  });

  return successResponse({ message: `Aprobación actualizada a: ${estadoFinal}`, approval: result.rows[0] });
});
