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
// Universo base: titulares FIRMADOS y SIN APROBAR, pendientes de gestión.
const BASE = `p."tipoUsuario"='TITULAR'
  AND p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> ''
  AND (p."aprobacion" IS NULL OR p."aprobacion" NOT IN ('Aprobado','Aprobada'))
  AND COALESCE(p."gestionContratoListo", false) = false
  AND (p."estado" IS NULL OR p."estado" <> 'FINALIZADA')
  AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'`;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const sp = new URL(request.url).searchParams;
  const asesor = (sp.get('asesor') || '').trim();
  const contrato = (sp.get('contrato') || '').trim();
  const numeroId = (sp.get('numeroId') || '').trim();
  const estado = (sp.get('estado') || '').trim();
  const startDate = (sp.get('startDate') || '').trim();
  const endDate = (sp.get('endDate') || '').trim();

  const where: string[] = [BASE];
  const params: any[] = [];
  if (asesor) { params.push(asesor); where.push(`p."asesor" = $${params.length}`); }
  if (contrato) { params.push(`%${contrato}%`); where.push(`p."contrato" ILIKE $${params.length}`); }
  if (numeroId) { params.push(`%${numeroId}%`); where.push(`p."numeroId" ILIKE $${params.length}`); }
  if (estado) { params.push(estado); where.push(`COALESCE(p."aprobacion",'Pendiente') = $${params.length}`); }
  if (startDate) { params.push(startDate); where.push(`COALESCE(p."fechaContrato", p."inicioContrato")::date >= $${params.length}::date`); }
  if (endDate) { params.push(endDate); where.push(`COALESCE(p."fechaContrato", p."inicioContrato")::date <= $${params.length}::date`); }

  const rows = (await query<any>(
    `SELECT p."_id", p."numeroId", p."contrato", p."plataforma", p."asesor",
            TRIM(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido")) AS nombre,
            COALESCE(p."fechaContrato", p."inicioContrato") AS fecha,
            p."aprobacion", p."estado", p."extemporanea"
       FROM "PEOPLE" p
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(p."fechaContrato", p."inicioContrato") DESC NULLS LAST
      LIMIT 1000`,
    params
  )).rows;

  // Opciones de los dropdowns (del universo base completo).
  const asesores = (await query<{ asesor: string }>(
    `SELECT DISTINCT p."asesor" FROM "PEOPLE" p WHERE ${BASE} AND p."asesor" IS NOT NULL AND p."asesor" <> '' ORDER BY p."asesor"`
  )).rows.map(r => r.asesor);
  const estados = (await query<{ estado: string }>(
    `SELECT DISTINCT COALESCE(p."aprobacion",'Pendiente') AS estado FROM "PEOPLE" p WHERE ${BASE} ORDER BY estado`
  )).rows.map(r => r.estado);

  return successResponse({ rows, total: rows.length, asesores, estados });
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
