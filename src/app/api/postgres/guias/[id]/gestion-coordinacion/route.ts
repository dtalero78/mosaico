/**
 * Cuánto tuvo que rescatar la Coordinación en el mes, para UN guía y comparado
 * con el resto.
 *
 * Tres cosas distintas, que no se pueden sumar entre sí porque no comparten
 * denominador:
 *   - CANCELADAS   — clases que el guía canceló (quedan en ADVISOR_EVENT_LOG).
 *   - SESIONES     — sesiones que cerró la Coordinación porque el guía no las
 *                    registró a tiempo (`CALENDARIO.motivoCierre` =
 *                    'GESTION_COORDINADOR', el mismo dato que pinta el distintivo
 *                    rojo en "Sesiones sin gestión").
 *   - REPORTES     — informes semanales que cerró la Coordinación sin que el guía
 *                    los hubiera cerrado (`cerradoGuiaPor IS NULL`).
 *
 * ⚠ Los cierres marcados `cerradoMasivo` NO cuentan: son decisiones
 * administrativas sobre una campaña entera (por ejemplo, cuando todavía no tiene
 * los alumnos definidos), no algo que el guía dejara de hacer.
 *
 * La comparación es una TASA, no un total: un guía con 40 sesiones y otro con 4
 * no son comparables en números absolutos. La del resto se calcula agregada
 * (suma de numeradores / suma de denominadores) y no como promedio de tasas, para
 * que un guía con dos clases no pese lo mismo que uno con cuarenta.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';
import { CORREOS_COORDINACION } from '@/lib/coordinacion';

const TZ = 'America/Santiago';

type Fila = { guia: string; num: number; den: number };

/** Tasa agregada de los demás guías (excluidas las cuentas de Coordinación). */
function comparar(filas: Fila[], guiaId: string) {
  const propio = filas.find(f => f.guia === guiaId);
  const pares = filas.filter(f => f.guia !== guiaId);
  const numP = pares.reduce((a, f) => a + f.num, 0);
  const denP = pares.reduce((a, f) => a + f.den, 0);
  return {
    valor: propio?.num || 0,
    base: propio?.den || 0,
    tasa: propio && propio.den > 0 ? propio.num / propio.den : null,
    tasaPares: denP > 0 ? numP / denP : null,
    pares: pares.length,
  };
}

export const GET = handlerWithAuth(async (request, ctx: any) => {
  const guiaId = String(ctx?.params?.id || '');
  if (!guiaId) throw new ValidationError('Falta el guía');

  const sp = new URL(request.url).searchParams;
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));   // 1-12
  if (!year || !month || month < 1 || month > 12) {
    throw new ValidationError('year y month (1-12) son requeridos');
  }

  // Guías que entran en la comparación: todos menos las cuentas de Coordinación.
  const guias = await queryMany<{ _id: string; nombreCompleto: string | null; email: string | null }>(
    `SELECT "_id","nombreCompleto","email" FROM "GUIAS"
      WHERE LOWER(TRIM(COALESCE("email",''))) <> ALL($1::text[])`,
    [CORREOS_COORDINACION]);
  const elegibles = guias.map(g => g._id);
  const yo = guias.find(g => g._id === guiaId);

  const rango = [year, month];

  // 1) Sesiones del mes por guía + las que cerró Coordinación.
  const ses = await queryMany<any>(
    `SELECT c."advisor" AS guia,
            COUNT(*)::int AS den,
            COUNT(*) FILTER (WHERE c."motivoCierre" = 'GESTION_COORDINADOR')::int AS num
       FROM "CALENDARIO" c
      WHERE c."advisor" = ANY($3::text[])
        AND EXTRACT(YEAR  FROM (c."dia" AT TIME ZONE '${TZ}')) = $1
        AND EXTRACT(MONTH FROM (c."dia" AT TIME ZONE '${TZ}')) = $2
      GROUP BY 1`, [...rango, elegibles]);

  // 2) Canceladas del mes por guía. El denominador es todo lo que tenía en la
  //    agenda: lo que dictó más lo que canceló o se suspendió.
  const logs = await queryMany<any>(
    `SELECT l."advisorId" AS guia,
            COUNT(*) FILTER (WHERE l."estado" = 'Canceled')::int  AS canceladas,
            COUNT(*)::int                                          AS movimientos
       FROM "ADVISOR_EVENT_LOG" l
      WHERE l."advisorId" = ANY($3::text[])
        AND EXTRACT(YEAR  FROM (l."fechaEvento" AT TIME ZONE '${TZ}')) = $1
        AND EXTRACT(MONTH FROM (l."fechaEvento" AT TIME ZONE '${TZ}')) = $2
      GROUP BY 1`, [...rango, elegibles]);

  // 3) Informes de la semana por guía + los que cerró Coordinación. El universo
  //    son los (salón, semana) que TUVIERON clase ese mes — igual que el informe
  //    "Reporte Académico sin gestión". IMPULSA no aplica.
  const rep = await queryMany<any>(
    `WITH semanas AS (
       SELECT cc."guia", cc."campaign", cc."tipoCurso" AS curso, cc."salon",
              (date_trunc('week', c."dia" AT TIME ZONE '${TZ}')::date) AS "semanaInicio"
         FROM "CALENDARIO" c
         JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
        WHERE cc."guia" = ANY($3::text[])
          AND UPPER(COALESCE(cc."tipoCurso",'')) <> 'IMPULSA'
          AND EXTRACT(YEAR  FROM (c."dia" AT TIME ZONE '${TZ}')) = $1
          AND EXTRACT(MONTH FROM (c."dia" AT TIME ZONE '${TZ}')) = $2
        GROUP BY 1,2,3,4,5
     )
     SELECT s."guia",
            COUNT(*)::int AS den,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM "REPORTE_ACADEMICO_CIERRE" ci
               WHERE ci."curso" = s.curso AND ci."salon" = s."salon"
                 AND ci."campaign" = s."campaign" AND ci."semanaInicio" = s."semanaInicio"
                 AND ci."estado" IN ('CERRADO_GUIA','DEFINITIVO')
                 AND ci."cerradoGuiaPor" IS NULL
                 AND ci."cerradoMasivo" IS NOT TRUE))::int AS num
       FROM semanas s GROUP BY 1`, [...rango, elegibles]);

  const filasSes: Fila[] = ses.map(r => ({ guia: r.guia, num: r.num, den: r.den }));
  const filasCan: Fila[] = logs.map(r => ({ guia: r.guia, num: r.canceladas, den: r.movimientos }));
  const filasRep: Fila[] = rep.map(r => ({ guia: r.guia, num: r.num, den: r.den }));

  // Las canceladas se miden sobre la agenda completa: dictadas + movimientos.
  const dictadas = new Map(filasSes.map(f => [f.guia, f.den]));
  for (const f of filasCan) f.den = (dictadas.get(f.guia) || 0) + f.den;
  for (const [g, d] of dictadas) if (!filasCan.some(f => f.guia === g)) filasCan.push({ guia: g, num: 0, den: d });

  return successResponse({
    guia: { id: guiaId, nombre: yo?.nombreCompleto || null, enComparacion: !!yo },
    year, month,
    canceladas: comparar(filasCan, guiaId),
    sesiones: comparar(filasSes, guiaId),
    reportes: comparar(filasRep, guiaId),
    excluidos: CORREOS_COORDINACION.length,
  });
});
