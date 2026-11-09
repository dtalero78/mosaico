/**
 * GET /api/postgres/reports/academico/eventos-registrados
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&advisorId=...&tipo=SESSION|CLUB
 *
 * Sesiones YA CERRADAS (sesionCerrada = true) en el rango, para que Coordinación
 * revise y, si hace falta, corrija la asistencia entrando con «Ir».
 *
 * Quedan fuera:
 *  - las NIVELACIONES (su cierre actualiza el historial de la nivelación),
 *  - las sesiones cuyo informe semanal del Reporte Académico ya está DEFINITIVO
 *    (cambiar la asistencia lo dejaría distinto de lo ya enviado al apoderado).
 *
 * Es de Coordinación: el rol GUIA recibe la lista vacía. Mismo permiso que
 * Procesos sin gestión (ACADEMICO.SESIONES_SIN_GESTION.VER).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';
import { alcancePorGuia } from '@/services/guia-sesion.service';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+)?$/;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SESIONES_SIN_GESTION_VER);

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const { soloPropios, guiaId: advisorId } = await alcancePorGuia(session, searchParams.get('advisorId'));
  const tipo = searchParams.get('tipo');
  const tzRaw = searchParams.get('tz');
  const tz = tzRaw && TZ_REGEX.test(tzRaw) ? tzRaw : 'America/Bogota';

  if (!startDate || !endDate) throw new ValidationError('startDate y endDate son requeridos');
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) throw new ValidationError('Fechas en formato YYYY-MM-DD');
  if (tipo && !['SESSION', 'CLUB'].includes(tipo)) throw new ValidationError('tipo debe ser SESSION o CLUB');

  // Es una herramienta de Coordinación: el guía no corrige sesiones ya cerradas.
  if (soloPropios) return successResponse({ items: [], total: 0 });

  const conds: string[] = [
    `c."dia" >= ($1::date) AT TIME ZONE $3`,
    `c."dia" <  ($2::date + INTERVAL '1 day') AT TIME ZONE $3`,
    `c."dia" < NOW()`,
    `c."sesionCerrada" = true`,
    `COALESCE(c."tipo", '') <> 'NIVELACION'`,
    // Informe semanal del salón ya DEFINITIVO: no se toca.
    `NOT EXISTS (
       SELECT 1 FROM "REPORTE_ACADEMICO_CIERRE" rc
        WHERE rc."estado" = 'DEFINITIVO'
          AND rc."curso" = cc."tipoCurso" AND rc."salon" = cc."salon" AND rc."campaign" = cc."campaign"
          AND rc."semanaInicio" = date_trunc('week', c."dia" AT TIME ZONE 'America/Santiago')::date
     )`,
  ];
  const params: any[] = [startDate, endDate, tz];
  let p = 4;
  if (advisorId) { conds.push(`c."advisor" = $${p++}`); params.push(advisorId); }
  if (tipo) { conds.push(`c."tipo" = $${p++}`); params.push(tipo); }

  const rows = await queryMany<any>(
    `SELECT
       c."_id" AS "eventoId", c."dia" AS "fechaEvento", c."tipo", c."nivel", c."step",
       cc."campaign", cc."tipoCurso" AS "curso", cc."salon",
       c."nombreEvento", c."advisor" AS "advisorId", adv."nombreCompleto" AS "advisorNombre",
       COALESCE(agg."inscritos", 0) AS "inscritos", COALESCE(agg."asistioMarcados", 0) AS "asistioMarcados"
     FROM "CALENDARIO" c
     LEFT JOIN "GUIAS" adv ON adv."_id" = c."advisor"
     LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE b."cancelo" IS NOT TRUE) AS "inscritos",
              COUNT(*) FILTER (WHERE b."asistio" = true OR b."asistencia" = true) AS "asistioMarcados"
         FROM "ACADEMICA_BOOKINGS" b
        WHERE b."eventoId" = c."_id" OR b."idEvento" = c."_id"
     ) agg ON true
     WHERE ${conds.join(' AND ')}
     ORDER BY c."dia" DESC, adv."nombreCompleto" ASC NULLS LAST
     LIMIT 2000`,
    params,
  );

  const items = rows.map(r => ({
    eventoId: r.eventoId,
    fechaEvento: r.fechaEvento ? new Date(r.fechaEvento).toISOString() : null,
    tipo: r.tipo, nivel: r.nivel, step: r.step,
    campaign: r.campaign, curso: r.curso, salon: r.salon,
    nombreEvento: r.nombreEvento,
    advisorId: r.advisorId,
    advisorNombre: r.advisorNombre || '(sin advisor)',
    inscritos: Number(r.inscritos ?? 0),
    asistioMarcados: Number(r.asistioMarcados ?? 0),
  }));
  return successResponse({ items, total: items.length });
});
