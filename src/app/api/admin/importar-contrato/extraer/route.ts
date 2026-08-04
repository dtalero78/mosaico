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

  // Por cada beneficiario: en qué campañas existe su curso (tipoCurso + horarioCurso)
  // y con qué salón. Sirve para sugerir la campaña y mostrar el salón resuelto.
  for (const b of extract.beneficiarios as any[]) {
    b.cursoMatches = [];
    if (b.tipoCurso && b.horarioCurso) {
      const m = await query<{ campaign: string; salon: string }>(
        `SELECT "campaign","salon" FROM "CURSOS_CAMPAIGN"
          WHERE UPPER("tipoCurso")=UPPER($1) AND "horarioCurso"=$2 AND "activa" IS NOT FALSE
          ORDER BY "campaign" DESC`,
        [b.tipoCurso, b.horarioCurso]
      );
      b.cursoMatches = m.rows;
      if (!m.rows.length) {
        extract.inconsistencias.push(`Beneficiario ${b.primerNombre || ''} ${b.primerApellido || ''}: no existe curso ${b.tipoCurso} ${b.horarioCurso} en ninguna campaña activa (quedará sin salón).`);
      }
    }
  }
  // Campañas candidatas: donde TODOS los beneficiarios con curso tienen match.
  const sets = (extract.beneficiarios as any[]).filter(b => b.cursoMatches?.length).map(b => new Set(b.cursoMatches.map((m: any) => m.campaign)));
  const candidateCampaigns = sets.length ? [...sets[0]].filter((c: any) => sets.every(s => s.has(c))) : [];

  return successResponse({ ...extract, campaigns, candidateCampaigns });
});
