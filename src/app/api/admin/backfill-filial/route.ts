import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError } from '@/lib/errors';
import { queryMany, query } from '@/lib/postgres';
import { resolverEscalera } from '@/lib/crm';

/**
 * POST /api/admin/backfill-filial?apply=1
 * Rellena `PEOPLE.filial` (titulares sin filial) y `EQUIPO_COMERCIAL.filial` con la filial del
 * asesor en el CRM (`User.filial`, o la del supervisor más cercano que la tenga). Nunca pisa
 * una filial ya cargada, salvo la grafía vieja «PITAGORA», que pasa al nombre del CRM.
 * Sin `apply` sólo informa. Sólo SUPER_ADMIN.
 */
export const POST = handlerWithAuth(async (req, _ctx, session) => {
  if ((session?.user as any)?.role !== 'SUPER_ADMIN') throw new ForbiddenError('Solo SUPER_ADMIN');
  const apply = new URL(req.url).searchParams.get('apply') === '1';

  const filas = await queryMany<any>(
    `SELECT "asesorMail","asesor", COUNT(*)::int n FROM "PEOPLE"
      WHERE "tipoUsuario"='TITULAR' AND COALESCE("filial",'')='' AND COALESCE("contrato",'') NOT LIKE 'PRB-%'
      GROUP BY 1,2`);
  const resueltas = new Map<string, string>();
  const sinFilial: { asesor: string; contratos: number }[] = [];
  let aActualizar = 0, actualizados = 0;
  for (const f of filas) {
    const k = `${String(f.asesorMail || '').toLowerCase()}|${String(f.asesor || '').trim().toLowerCase()}`;
    let fil = resueltas.get(k);
    if (fil === undefined) {
      const esc = await resolverEscalera(f.asesorMail, f.asesor);
      fil = esc?.filial || '';
      resueltas.set(k, fil);
    }
    if (!fil) { sinFilial.push({ asesor: `${f.asesor || ''} <${f.asesorMail || ''}>`, contratos: f.n }); continue; }
    aActualizar += f.n;
    if (apply) {
      const r = await query(
        `UPDATE "PEOPLE" SET "filial"=$1, "_updatedDate"=NOW()
          WHERE "tipoUsuario"='TITULAR' AND COALESCE("filial",'')='' AND COALESCE("contrato",'') NOT LIKE 'PRB-%'
            AND COALESCE("asesorMail",'') = COALESCE($2,'') AND LOWER(TRIM(COALESCE("asesor",''))) = $3`,
        [fil, f.asesorMail, String(f.asesor || '').trim().toLowerCase()]);
      actualizados += r.rowCount || 0;
    }
  }
  let pitagora = 0;
  if (apply) {
    pitagora = (await query(`UPDATE "PEOPLE" SET "filial"='PITÁGORAS' WHERE "filial"='PITAGORA'`)).rowCount || 0;
    await query(`UPDATE "EQUIPO_COMERCIAL" SET "filial"='PITÁGORAS' WHERE "filial"='PITAGORA'`);
    // Catálogo del equipo comercial: misma regla por correo/nombre.
    const eq = await queryMany<any>(`SELECT "_id","correo","nombre" FROM "EQUIPO_COMERCIAL" WHERE COALESCE("filial",'')=''`);
    for (const e of eq) {
      const esc = await resolverEscalera(e.correo, e.nombre);
      if (esc?.filial) await query(`UPDATE "EQUIPO_COMERCIAL" SET "filial"=$1 WHERE "_id"=$2`, [esc.filial, e._id]);
    }
  }
  const resumen = await queryMany<any>(
    `SELECT COALESCE(NULLIF("filial",''),'(sin filial)') filial, COUNT(*)::int n FROM "PEOPLE"
      WHERE "tipoUsuario"='TITULAR' AND COALESCE("contrato",'') NOT LIKE 'PRB-%' GROUP BY 1 ORDER BY n DESC`);
  return successResponse({ apply, aActualizar, actualizados, pitagoraRenombrados: pitagora, sinFilial, resumen });
});
