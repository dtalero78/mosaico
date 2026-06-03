/**
 * GET /api/postgres/reports/academico/admin-events-sin-registrar
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&advisorId=&tipo=&tz=
 *
 * Lista admin events PASADOS (fechaInicio < NOW()) y NO registrados, para que
 * el coordinador los gestione desde el panel-advisor del advisor correspondiente.
 *
 * Permiso: ACADEMICO.SESIONES_SIN_GESTION.VER (mismo que sesiones académicas).
 * Default cliente: ayer (excluye hoy — aún en ventana operativa).
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

  const conds: string[] = [
    `ae."fechaInicio" >= ($1::date) AT TIME ZONE $3`,
    `ae."fechaInicio" <  ($2::date + INTERVAL '1 day') AT TIME ZONE $3`,
    `ae."fechaInicio" < NOW()`,
    `ae."registrado" = false`,
  ];
  const params: any[] = [startDate, endDate, tz];
  let p = 4;
  if (advisorId) { conds.push(`ae."advisorId" = $${p++}`); params.push(advisorId); }
  if (tipo)      { conds.push(`ae."tipo" = $${p++}`); params.push(tipo); }

  const rows = await queryMany<any>(
    `SELECT
       ae."_id"                                AS "eventoId",
       ae."eventGroupId",
       ae."fechaInicio",
       ae."tipo",
       ae."titulo",
       ae."horas",
       ae."advisorId",
       adv."nombreCompleto"                     AS "advisorNombre",
       adv."fotoAdvisor"                        AS "advisorFoto",
       adv."email"                              AS "advisorEmail"
     FROM "ADMIN_EVENTS" ae
     LEFT JOIN "ADVISORS" adv ON adv."_id" = ae."advisorId"
     WHERE ${conds.join(' AND ')}
     ORDER BY ae."fechaInicio" DESC, adv."nombreCompleto" ASC NULLS LAST
     LIMIT 2000`,
    params,
  );

  return successResponse({
    items: rows,
    total: rows.length,
    rangoFiltro: { startDate, endDate, advisorId: advisorId || null, tipo: tipo || null },
  });
});
