import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { getUserComercialScope } from '@/lib/crm';

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
  const lider = (sp.get('lider') || '').trim();
  const startDate = (sp.get('startDate') || '').trim();
  const endDate = (sp.get('endDate') || '').trim();

  // Scope por líder: un Gerente/Jefe de Grupo sólo ve los contratos de SU equipo
  // (liderComercialCorreo = su correo); Sales Manager+ y admins ven todo.
  const role = (session as any)?.user?.role;
  const email = (session as any)?.user?.email || '';
  const scope = (role === 'SUPER_ADMIN' || role === 'ADMIN')
    ? { seeAll: true, liderCorreo: null as string | null }
    : await getUserComercialScope(email);
  // Fragmento de scope para las consultas de dropdowns (usan $1 propio).
  const scopeFrag = scope.seeAll ? '' : ` AND LOWER(p."liderComercialCorreo") = LOWER($1)`;
  const scopeArgs: any[] = scope.seeAll ? [] : [scope.liderCorreo];

  const where: string[] = [BASE];
  const params: any[] = [];
  if (!scope.seeAll) { params.push(scope.liderCorreo); where.push(`LOWER(p."liderComercialCorreo") = LOWER($${params.length})`); }
  if (asesor) { params.push(asesor); where.push(`p."asesor" = $${params.length}`); }
  if (contrato) { params.push(`%${contrato}%`); where.push(`p."contrato" ILIKE $${params.length}`); }
  if (numeroId) { params.push(`%${numeroId}%`); where.push(`p."numeroId" ILIKE $${params.length}`); }
  if (estado) { params.push(estado); where.push(`COALESCE(p."aprobacion",'Pendiente') = $${params.length}`); }
  if (lider) {
    if (lider === '(Sin líder)') { where.push(`p."liderComercial" IS NULL`); }
    else { params.push(lider); where.push(`p."liderComercial" = $${params.length}`); }
  }
  if (startDate) { params.push(startDate); where.push(`COALESCE(p."fechaContrato", p."inicioContrato")::date >= $${params.length}::date`); }
  if (endDate) { params.push(endDate); where.push(`COALESCE(p."fechaContrato", p."inicioContrato")::date <= $${params.length}::date`); }

  const rows = (await query<any>(
    `SELECT p."_id", p."numeroId", p."contrato", p."plataforma", p."asesor",
            TRIM(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido")) AS nombre,
            COALESCE(p."fechaContrato", p."inicioContrato") AS fecha,
            p."aprobacion", p."estado", p."extemporanea", p."liderComercial"
       FROM "PEOPLE" p
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(p."fechaContrato", p."inicioContrato") DESC NULLS LAST
      LIMIT 1000`,
    params
  )).rows;

  // Opciones de los dropdowns (respetan el mismo scope por líder).
  const asesores = (await query<{ asesor: string }>(
    `SELECT DISTINCT p."asesor" FROM "PEOPLE" p WHERE ${BASE}${scopeFrag} AND p."asesor" IS NOT NULL AND p."asesor" <> '' ORDER BY p."asesor"`,
    scopeArgs
  )).rows.map(r => r.asesor);
  const estados = (await query<{ estado: string }>(
    `SELECT DISTINCT COALESCE(p."aprobacion",'Pendiente') AS estado FROM "PEOPLE" p WHERE ${BASE}${scopeFrag} ORDER BY estado`,
    scopeArgs
  )).rows.map(r => r.estado);
  const lideres = (await query<{ lider: string }>(
    `SELECT DISTINCT p."liderComercial" AS lider FROM "PEOPLE" p WHERE ${BASE}${scopeFrag} AND p."liderComercial" IS NOT NULL AND p."liderComercial" <> '' ORDER BY p."liderComercial"`,
    scopeArgs
  )).rows.map(r => r.lider);

  return successResponse({ rows, total: rows.length, asesores, estados, lideres, scope: { seeAll: scope.seeAll } });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const b = await request.json().catch(() => ({}));
  const id = String(b?.id || '').trim();
  if (!id) throw new ValidationError('Falta el titular.');
  const role = (session as any)?.user?.role;
  const email = (session as any)?.user?.email || 'desconocido';
  const scope = (role === 'SUPER_ADMIN' || role === 'ADMIN')
    ? { seeAll: true, liderCorreo: null as string | null }
    : await getUserComercialScope(email);
  const params: any[] = [id, email];
  let scopeSql = '';
  if (!scope.seeAll) { params.push(scope.liderCorreo); scopeSql = ` AND LOWER("liderComercialCorreo") = LOWER($${params.length})`; }
  const r = await query(
    `UPDATE "PEOPLE" SET "gestionContratoListo"=true, "gestionContratoListoBy"=$2, "gestionContratoListoDate"=NOW()
      WHERE "_id"=$1 AND "tipoUsuario"='TITULAR'${scopeSql}`,
    params
  );
  if (!r.rowCount) throw new ValidationError('No se encontró el titular (o está fuera de tu equipo).');
  return successResponse({ ok: true });
});
