import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';

/**
 * GET /api/postgres/comercial/gestion-contrato
 *   Titulares con contrato FIRMADO (consentimiento) y SIN APROBAR, pendientes de
 *   gestión (no marcados "listo"). Columnas: nombre, contrato, fecha, estado.
 *
 * POST … { id }  → "Dejar listo": marca el contrato como gestionado (sale de la lista).
 * Gateado por COMERCIAL.GESTION_CONTRATO.VER.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const sp = new URL(request.url).searchParams;
  const search = (sp.get('search') || '').trim();

  const params: any[] = [];
  let filtro = '';
  if (search) {
    params.push(`%${search}%`);
    filtro = `AND (p."numeroId" ILIKE $1 OR p."contrato" ILIKE $1
      OR TRIM(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido")) ILIKE $1)`;
  }

  const rows = (await query<any>(
    `SELECT p."_id", p."numeroId", p."contrato", p."plataforma",
            TRIM(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido")) AS nombre,
            COALESCE(p."fechaContrato", p."inicioContrato") AS fecha,
            p."aprobacion", p."estado", p."extemporanea"
       FROM "PEOPLE" p
      WHERE p."tipoUsuario"='TITULAR'
        AND p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> ''
        AND (p."aprobacion" IS NULL OR p."aprobacion" NOT IN ('Aprobado','Aprobada'))
        AND COALESCE(p."gestionContratoListo", false) = false
        AND (p."estado" IS NULL OR p."estado" <> 'FINALIZADA')
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
        ${filtro}
      ORDER BY COALESCE(p."fechaContrato", p."inicioContrato") DESC NULLS LAST
      LIMIT 1000`,
    params
  )).rows;

  return successResponse({ rows, total: rows.length });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const b = await request.json().catch(() => ({}));
  const id = String(b?.id || '').trim();
  if (!id) throw new ValidationError('Falta el titular.');
  const email = (session as any)?.user?.email || 'desconocido';
  const r = await query(
    `UPDATE "PEOPLE" SET "gestionContratoListo"=true, "gestionContratoListoBy"=$2, "gestionContratoListoDate"=NOW()
      WHERE "_id"=$1 AND "tipoUsuario"='TITULAR'`,
    [id, email]
  );
  if (!r.rowCount) throw new ValidationError('No se encontró el titular.');
  return successResponse({ ok: true });
});
