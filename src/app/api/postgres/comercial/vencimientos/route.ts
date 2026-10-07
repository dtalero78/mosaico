import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { query } from '@/lib/postgres';
import { ComercialPermission } from '@/types/permissions';
import { esAprobadoSql } from '@/lib/estados';
import { getSessionComercialScope } from '@/lib/crm';
import { addMonths, hoyEnChile } from '@/lib/cursos-campaign';

/**
 * GET /api/postgres/comercial/vencimientos
 *   ?desde=YYYY-MM-DD   (default: hoy en Chile)
 *   &hasta=YYYY-MM-DD   (default: hoy + 1 mes)
 *   &campaign=...       (vacío = todas)
 *   &curso=...          (vacío = todos)
 *   &asesor=...         (vacío = todos; compara sin mayúsculas ni espacios al borde)
 *
 * Contratos que VENCEN (`finalContrato`) dentro del rango: una fila por titular,
 * con su correo, teléfono y si es un contrato Módulo.
 *
 * Universo: titulares APROBADOS que aún no están finalizados y que no son de
 * prueba (`PRB-`). La campaña y el curso viven en los BENEFICIARIOS, así que el
 * filtro pregunta si el contrato tiene algún beneficiario en ellos.
 *
 * Alcance: el mismo de Gestión Contrato — un líder comercial ve sólo los
 * contratos de su equipo; admins y quien no está en el CRM ven todos.
 */

const MAX_ROWS = 3000;

const UNIVERSO = `
      p."tipoUsuario" = 'TITULAR'
  AND ${esAprobadoSql('p."aprobacion"')}
  AND (p."estado" IS NULL OR p."estado" <> 'FINALIZADA')
  AND p."finalContrato" IS NOT NULL
  AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'`;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.VENCIMIENTOS);

  const sp = new URL(request.url).searchParams;
  const hoy = hoyEnChile();
  const desde = sp.get('desde') || hoy;
  const hasta = sp.get('hasta') || addMonths(hoy, 1);
  const campaign = (sp.get('campaign') || '').trim();
  const curso = (sp.get('curso') || '').trim();
  const asesor = (sp.get('asesor') || '').trim();

  // Alcance por líder: se aplica a las filas Y a las opciones de los filtros,
  // para no ofrecer una campaña o un asesor que el usuario no puede ver.
  const scope = await getSessionComercialScope(session);
  const scopeParams: any[] = [];
  let scopeSql = '';
  if (!scope.seeAll) {
    scopeParams.push(scope.liderCorreo);
    scopeSql = ` AND LOWER(p."liderComercialCorreo") = LOWER($1)`;
  }

  const params: any[] = [...scopeParams];
  const conds: string[] = [];
  params.push(desde); conds.push(`p."finalContrato" >= $${params.length}::date`);
  params.push(hasta); conds.push(`p."finalContrato" <= $${params.length}::date`);
  if (campaign) {
    params.push(campaign);
    conds.push(`EXISTS (SELECT 1 FROM "PEOPLE" b WHERE b."contrato" = p."contrato"
                          AND b."tipoUsuario" = 'BENEFICIARIO' AND b."campaign" = $${params.length})`);
  }
  if (curso) {
    params.push(curso);
    conds.push(`EXISTS (SELECT 1 FROM "PEOPLE" b WHERE b."contrato" = p."contrato"
                          AND b."tipoUsuario" = 'BENEFICIARIO' AND UPPER(b."tipoCurso") = UPPER($${params.length}))`);
  }
  if (asesor) {
    params.push(asesor);
    conds.push(`LOWER(TRIM(p."asesor")) = LOWER(TRIM($${params.length}))`);
  }

  const rows = (await query<any>(
    `SELECT p."_id", p."numeroId", p."contrato", p."email", p."celular", p."asesor",
            TRIM(CONCAT_WS(' ', TRIM(p."primerNombre"), TRIM(p."segundoNombre"),
                                TRIM(p."primerApellido"), TRIM(p."segundoApellido"))) AS nombre,
            p."finalContrato"::text AS "finalContrato",
            (p."finalContrato"::date - $${params.length + 1}::date)::int AS "diasRestantes",
            COALESCE(p."modulo", false) AS modulo,
            bf.campanias, bf.cursos
       FROM "PEOPLE" p
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(DISTINCT b."campaign", ', ') AS campanias,
                STRING_AGG(DISTINCT UPPER(b."tipoCurso"), ', ') AS cursos
           FROM "PEOPLE" b
          WHERE b."contrato" = p."contrato" AND b."tipoUsuario" = 'BENEFICIARIO'
       ) bf ON true
      WHERE ${UNIVERSO}${scopeSql} AND ${conds.join(' AND ')}
      ORDER BY p."finalContrato" ASC, nombre ASC
      LIMIT ${MAX_ROWS}`,
    [...params, hoy]
  )).rows;

  // Opciones de los filtros: sobre el universo completo (sin fechas ni filtros
  // elegidos), así elegir una campaña no hace desaparecer las demás.
  const opciones = (await query<any>(
    `SELECT
       (SELECT ARRAY_AGG(DISTINCT b."campaign" ORDER BY b."campaign")
          FROM "PEOPLE" p JOIN "PEOPLE" b ON b."contrato" = p."contrato" AND b."tipoUsuario" = 'BENEFICIARIO'
         WHERE ${UNIVERSO}${scopeSql} AND b."campaign" IS NOT NULL AND b."campaign" <> '') AS campanias,
       (SELECT ARRAY_AGG(DISTINCT UPPER(b."tipoCurso") ORDER BY UPPER(b."tipoCurso"))
          FROM "PEOPLE" p JOIN "PEOPLE" b ON b."contrato" = p."contrato" AND b."tipoUsuario" = 'BENEFICIARIO'
         WHERE ${UNIVERSO}${scopeSql} AND b."tipoCurso" IS NOT NULL AND b."tipoCurso" <> '') AS cursos,
       (SELECT ARRAY_AGG(a ORDER BY a) FROM (
          SELECT DISTINCT ON (LOWER(TRIM(p."asesor"))) TRIM(p."asesor") AS a
            FROM "PEOPLE" p
           WHERE ${UNIVERSO}${scopeSql} AND p."asesor" IS NOT NULL AND TRIM(p."asesor") <> ''
           ORDER BY LOWER(TRIM(p."asesor")), TRIM(p."asesor")
       ) x) AS asesores`,
    scopeParams
  )).rows[0] || {};

  return successResponse({
    rango: { desde, hasta },
    rows: rows.map((r: any) => ({ ...r, diasRestantes: Number(r.diasRestantes) })),
    total: rows.length,
    capped: rows.length >= MAX_ROWS,
    opciones: {
      campanias: opciones.campanias || [],
      cursos: opciones.cursos || [],
      asesores: opciones.asesores || [],
    },
  });
});
