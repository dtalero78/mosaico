/**
 * GET /api/postgres/reports/academico/sesiones-sin-gestion
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&advisorId=...&tipo=SESSION|CLUB
 *
 * Lista de eventos PASADOS sin cerrar (sesionCerrada=false), pensado para el
 * coordinador académico que necesita detectar y cerrar el backlog de sesiones
 * que el advisor no registró dentro de su ventana de +120 min.
 *
 * Filtros:
 *   - startDate/endDate: rango de `CALENDARIO.dia` en TZ Bogotá (default
 *     manejado por el cliente — aquí solo aplicamos lo que llegue).
 *   - advisorId: opcional, filtra por ADVISORS._id
 *   - tipo: opcional, SESSION o CLUB (default ambos)
 *
 * Reglas inalterables:
 *   - dia < NOW() — solo eventos que ya pasaron
 *   - sesionCerrada IS NOT TRUE — sin cerrar (incluye NULL y false)
 *   - Por defecto el cliente EXCLUYE hoy (se filtra con endDate < hoy local).
 *
 * Permiso: ACADEMICO.SESIONES_SIN_GESTION.VER (SUPER_ADMIN/ADMIN bypass).
 *
 * Performance: LEFT JOIN LATERAL agrupa inscritos + asistencia marcada por
 * evento en una sola query (mismo patrón que advisor-event-log.service para
 * usar índices idx_bookings_evento e idx_bookings_idevento sin COALESCE que
 * los bloquea).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+)?$/;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SESIONES_SIN_GESTION_VER);

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');
  const advisorId = searchParams.get('advisorId');
  const tipo      = searchParams.get('tipo');
  const tzRaw     = searchParams.get('tz');
  const tz = tzRaw && TZ_REGEX.test(tzRaw) ? tzRaw : 'America/Bogota';

  if (!startDate || !endDate) throw new ValidationError('startDate y endDate son requeridos');
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
    throw new ValidationError('Fechas en formato YYYY-MM-DD');
  }
  if (tipo && !['SESSION', 'CLUB'].includes(tipo)) {
    throw new ValidationError('tipo debe ser SESSION o CLUB');
  }

  const conds: string[] = [
    // El día del evento debe caer entre startDate 00:00 y endDate 23:59:59 en la TZ del usuario.
    `c."dia" >= ($1::date) AT TIME ZONE $3`,
    `c."dia" <  ($2::date + INTERVAL '1 day') AT TIME ZONE $3`,
    // Solo eventos pasados (NOW global, no por TZ — comparación timestamp directa)
    `c."dia" < NOW()`,
    // No cerrados
    `(c."sesionCerrada" IS NULL OR c."sesionCerrada" = false)`,
  ];
  const params: any[] = [startDate, endDate, tz];
  let p = 4;

  if (advisorId) { conds.push(`c."advisor" = $${p++}`); params.push(advisorId); }
  if (tipo)      { conds.push(`c."tipo" = $${p++}`);    params.push(tipo); }

  const rows = await queryMany<any>(
    `SELECT
       c."_id"                                                  AS "eventoId",
       c."dia"                                                  AS "fechaEvento",
       c."tipo",
       c."nivel", c."step",
       COALESCE(c."tituloONivel", c."titulo", c."nombreEvento") AS "tituloEvento",
       c."nombreEvento",
       c."advisor"                                              AS "advisorId",
       adv."nombreCompleto"                                     AS "advisorNombre",
       adv."fotoAdvisor"                                        AS "advisorFoto",
       COALESCE(agg."inscritos",       0)                       AS "inscritos",
       COALESCE(agg."asistioMarcados", 0)                       AS "asistioMarcados"
     FROM "CALENDARIO" c
     LEFT JOIN "ADVISORS" adv ON adv."_id" = c."advisor"
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE b."cancelo" IS NOT TRUE) AS "inscritos",
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
    tipo: r.tipo,
    nivel: r.nivel,
    step: r.step,
    tituloEvento: r.tituloEvento,
    nombreEvento: r.nombreEvento,
    advisorId: r.advisorId,
    advisorNombre: r.advisorNombre || '(sin advisor)',
    advisorFoto: r.advisorFoto || null,
    inscritos: Number(r.inscritos ?? 0),
    asistioMarcados: Number(r.asistioMarcados ?? 0),
  }));

  return successResponse({
    items,
    total: items.length,
    rangoFiltro: { startDate, endDate, advisorId: advisorId || null, tipo: tipo || null },
  });
});
