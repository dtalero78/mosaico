import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError } from '@/lib/errors';
import { getUserComercialScope } from '@/lib/crm';
import { query } from '@/lib/postgres';

/**
 * GET /api/admin/crm-equipo?email=a@b.cl
 * Diagnóstico de SOLO LECTURA del alcance comercial de un usuario: su rango, la escalera
 * hacia abajo que trae el CRM y cuántos titulares de PEOPLE caen en ese alcance.
 * Sólo SUPER_ADMIN.
 */
export const GET = handlerWithAuth(async (req, _ctx, session) => {
  if ((session?.user as any)?.role !== 'SUPER_ADMIN') throw new ForbiddenError('Solo SUPER_ADMIN');
  const email = new URL(req.url).searchParams.get('email') || '';
  const scope = await getUserComercialScope(email);
  let titulares = null as number | null;
  let porAsesor: any[] = [];
  if (!scope.seeAll) {
    const cond = `ARRAY[LOWER(COALESCE("liderComercialCorreo",'')), LOWER(COALESCE("asesorMail",'')), LOWER(TRIM(COALESCE("asesor",'')))] && $1::text[]`;
    titulares = (await query(`SELECT COUNT(*)::int n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND COALESCE("contrato",'') NOT LIKE 'PRB-%' AND ${cond}`, [scope.equipo])).rows[0].n;
    porAsesor = (await query(`SELECT "asesor", COUNT(*)::int n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND COALESCE("contrato",'') NOT LIKE 'PRB-%' AND ${cond} GROUP BY 1 ORDER BY n DESC LIMIT 40`, [scope.equipo])).rows;
  }
  return successResponse({ scope: { seeAll: scope.seeAll, position: scope.position, liderCorreo: scope.liderCorreo, equipoSize: scope.equipo.length, equipo: scope.equipo }, titulares, porAsesor });
});
