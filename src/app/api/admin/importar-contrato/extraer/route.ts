import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { extraerContratoDePdf } from '@/services/contrato-pdf-extract.service';

/**
 * POST /api/admin/importar-contrato/extraer  (multipart: pdf)
 * Extrae los datos del PDF de un contrato (plantilla MOSAICO/IMPULSA) con IA y los
 * devuelve mapeados a la forma de migrar-contrato + un log de inconsistencias +
 * las campañas disponibles para el dropdown. NO crea nada (eso lo hace luego el
 * front vía /api/admin/migrar-contrato tras la revisión).
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.IMPORTAR_CONTRATO_PDF);

  const form = await request.formData().catch(() => null);
  const file = form?.get('pdf') as File | null;
  if (!file) throw new ValidationError('Falta el archivo PDF.');
  if (file.size > 15 * 1024 * 1024) throw new ValidationError('El PDF supera 15 MB.');
  const buffer = Buffer.from(await file.arrayBuffer());

  let extract;
  try {
    extract = await extraerContratoDePdf(buffer);
  } catch (err: any) {
    if (err?.code === 'NO_TEXT') throw new ValidationError(err.message);
    throw err;
  }

  // Campañas disponibles (para enganchar el curso de los beneficiarios).
  const campaigns = (await query<{ campaign: string }>(
    `SELECT DISTINCT "campaign" FROM "CURSOS_CAMPAIGN" WHERE "activa" IS NOT FALSE ORDER BY "campaign" DESC`
  )).rows.map(r => r.campaign);

  return successResponse({ ...extract, campaigns });
});
