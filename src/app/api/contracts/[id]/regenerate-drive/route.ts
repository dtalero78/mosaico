import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { regenerarContratoEnDrive } from '@/services/contract-archive.service';

/**
 * POST /api/contracts/[id]/regenerate-drive
 *
 * Regenera el PDF del contrato con Chromium propio (puppeteer-core) y lo sube a
 * Drive. NO envía WhatsApp. La lógica vive en `regenerarContratoEnDrive`
 * (contract-archive.service), que también usa la aprobación de contratos
 * migrados; aquí sólo se valida el permiso y se arma la respuesta.
 *
 * Útil para casos donde se detecta un error en un contrato ya entregado:
 *   - bug que dejó valores financieros vacíos
 *   - corrección de datos del titular tras envío
 *   - ajuste de template
 *
 * Acceso: roles con `MANTENIMIENTO.USUARIOS.GENERAR_CONTRATO` o
 *         SUPER_ADMIN / ADMIN (bypass).
 */
export const POST = handlerWithAuth(async (_request, { params }, session) => {
  await requirePermission(session, MantenimientoPermission.GENERAR_CONTRATO);

  const titularId = params.id;
  const titular = await queryOne<any>(
    `SELECT "_id", "primerNombre", "primerApellido", "numeroId" FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);

  const r = await regenerarContratoEnDrive(titularId);

  return successResponse({
    destino: r.destino,
    ...(r.destino === 'DRIVE_LGS_TEMPORAL'
      ? { aviso: 'Subido a la carpeta de LGS vía bsl-utilidades (puente temporal). Pendiente: mover el proceso a la carpeta CONTRATOS MOS con el Drive propio.' }
      : {}),
    archivo: r.archivo,
    driveUpload: r.driveUpload,
    pdfBytes: r.pdfBytes,
    contrato: r.contrato,
    titular,
  });
});
