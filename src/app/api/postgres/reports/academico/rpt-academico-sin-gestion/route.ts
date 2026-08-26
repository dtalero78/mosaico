/**
 * Salones que NO han cerrado su Reporte Académico.
 *
 * Es el equivalente de "Sesiones sin gestión", pero la unidad aquí no es el
 * evento sino el **(salón, semana)**: el informe se cierra por salón y semana,
 * no por clase.
 *
 * El universo son los salones que **tuvieron clase** esa semana. Un salón sin
 * clases no debía reportar nada, así que listarlo sería ruido. Los eventos se
 * enganchan por `cursoCampaignId` —no por las columnas campaign/curso/salon del
 * propio evento, que están vacías en la mayoría— y **IMPULSA queda fuera**: no
 * usa el Reporte Académico.
 *
 * Se distinguen dos formas de "sin gestión", porque no son lo mismo para quien
 * hace seguimiento:
 *   - SIN_EMPEZAR : ni una fila guardada. El guía no entró.
 *   - BORRADOR    : hay valoraciones guardadas pero no lo cerró.
 *
 * ⚠ La CAMPAÑA se trata distinto en cada tabla, y no es un capricho: `(curso,
 * salón)` se repite hasta en 4 campañas a la vez, con guías distintos.
 *   - `REPORTE_ACADEMICO_CIERRE` la tiene en todas sus filas → se EXIGE. Sin
 *     ella, el cierre de un salón taparía el de las otras campañas con el mismo
 *     número y saldrían como gestionadas sin estarlo.
 *   - `REPORTE_ACADEMICO_NOTAS` tiene la mitad de las filas con `campaign` NULL
 *     (datos viejos) → se acepta la que coincida O la nula, que es lo mejor
 *     disponible para esas filas.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 3000;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.RPT_ACADEMICO_SIN_GESTION_VER);

  const sp = new URL(request.url).searchParams;
  const startDate = sp.get('startDate');
  const endDate = sp.get('endDate');
  const advisorId = (sp.get('advisorId') || '').trim();
  const campaign = (sp.get('campaign') || '').trim();
  const curso = (sp.get('curso') || '').trim();

  if (!startDate || !endDate) throw new ValidationError('startDate y endDate son requeridos');
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
    throw new ValidationError('Fechas en formato YYYY-MM-DD');
  }

  const cond: string[] = [];
  const params: any[] = [startDate, endDate];
  let p = 3;
  if (advisorId) { cond.push(`cc."guia" = $${p++}`); params.push(advisorId); }
  if (campaign) { cond.push(`cc."campaign" = $${p++}`); params.push(campaign); }
  if (curso) { cond.push(`cc."tipoCurso" = $${p++}`); params.push(curso); }
  const extra = cond.length ? `AND ${cond.join(' AND ')}` : '';

  const rows = await queryMany<any>(
    `WITH semanas AS (
       -- Un (salón, semana) por cada semana en que el salón tuvo clase dentro del
       -- rango. date_trunc('week') da el LUNES, que es la llave del informe.
       SELECT cc."_id"        AS "cursoCampaignId",
              cc."guia",
              cc."campaign",
              cc."tipoCurso"  AS curso,
              cc."salon",
              (date_trunc('week', c."dia")::date) AS "semanaInicio",
              COUNT(*)::int                       AS sesiones,
              MAX(c."dia")                        AS "ultimaClase"
         FROM "CALENDARIO" c
         JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
        WHERE c."dia" >= $1::date
          AND c."dia" <  ($2::date + INTERVAL '1 day')
          AND c."dia" <  NOW()                       -- semanas que ya ocurrieron
          AND UPPER(COALESCE(cc."tipoCurso", '')) <> 'IMPULSA'
          ${extra}
        GROUP BY 1,2,3,4,5,6
     )
     SELECT s.*,
            g."nombreCompleto" AS "guiaNombre",
            -- Cuántos alumnos ocupan ese salón (los que debían valorarse).
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
              WHERE pe."tipoUsuario" = 'BENEFICIARIO'
                AND pe."campaign"  = s."campaign"
                AND pe."tipoCurso" = s.curso
                AND pe."salon"     = s."salon"
                AND COALESCE(pe."contrato",'') NOT LIKE 'PRB-%') AS alumnos,
            -- Filas ya guardadas: separa "no entró" de "empezó y no cerró".
            (SELECT COUNT(*)::int FROM "REPORTE_ACADEMICO_NOTAS" n
              WHERE n."curso" = s.curso AND n."salon" = s."salon"
                AND n."semanaInicio" = s."semanaInicio"
                AND (n."campaign" = s."campaign" OR n."campaign" IS NULL)) AS "notasGuardadas",
            (SELECT MAX(n."_updatedDate") FROM "REPORTE_ACADEMICO_NOTAS" n
              WHERE n."curso" = s.curso AND n."salon" = s."salon"
                AND n."semanaInicio" = s."semanaInicio"
                AND (n."campaign" = s."campaign" OR n."campaign" IS NULL)) AS "ultimaEdicion"
       FROM semanas s
       LEFT JOIN "GUIAS" g ON g."_id" = s."guia"
      WHERE NOT EXISTS (
        SELECT 1 FROM "REPORTE_ACADEMICO_CIERRE" ci
         WHERE ci."curso" = s.curso AND ci."salon" = s."salon"
           AND ci."campaign" = s."campaign"
           AND ci."semanaInicio" = s."semanaInicio"
           AND ci."estado" IN ('CERRADO_GUIA','DEFINITIVO')
      )
      ORDER BY s."semanaInicio" DESC, UPPER(g."nombreCompleto") NULLS LAST, s.curso, s."salon"
      LIMIT ${MAX_ROWS}`,
    params
  );

  const out = rows.map((r: any) => ({
    ...r,
    semanaInicio: String(r.semanaInicio).slice(0, 10),
    estado: Number(r.notasGuardadas) > 0 ? 'BORRADOR' : 'SIN_EMPEZAR',
  }));

  const guias = Array.from(
    new Map(out.filter(r => r.guia).map(r => [r.guia, { id: r.guia, nombre: r.guiaNombre }])).values()
  );

  return successResponse({
    rows: out,
    total: out.length,
    sinEmpezar: out.filter(r => r.estado === 'SIN_EMPEZAR').length,
    guiasInvolucrados: new Set(out.map(r => r.guia).filter(Boolean)).size,
    guias,
    campaigns: Array.from(new Set(out.map(r => r.campaign).filter(Boolean))).sort(),
    cursos: Array.from(new Set(out.map(r => r.curso).filter(Boolean))).sort(),
    truncado: out.length >= MAX_ROWS,
  });
});
