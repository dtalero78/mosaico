/**
 * GET /api/postgres/reports/academico/admin-events-sin-registrar
 *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&advisorId=&tipo=&tz=
 *
 * Lista admin events PASADOS (fechaInicio < NOW()) y NO registrados, para que
 * el coordinador los gestione desde el panel-advisor del advisor correspondiente.
 *
 * Permiso: ACADEMICO.SESIONES_SIN_GESTION.VER (mismo que sesiones académicas).
 * Default cliente: ayer (excluye hoy — aún en ventana operativa).
 *
 * ⚠ El rol GUIA ve SÓLO sus eventos: el guía sale del correo de la sesión y el
 * `advisorId` que llegue se ignora.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';
import { alcancePorGuia } from '@/services/guia-sesion.service';
import { autorizacionesDe, puedeAutorizarGestion } from '@/services/autorizacion-gestion.service';
import { eventoAdminVencido } from '@/lib/autorizacion-gestion';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TZ_REGEX = /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+)?$/;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SESIONES_SIN_GESTION_VER);

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');
  const { soloPropios, guiaId: advisorId } = await alcancePorGuia(session, searchParams.get('advisorId'));
  const tipo      = searchParams.get('tipo');
  const tzRaw     = searchParams.get('tz');
  const tz = tzRaw && TZ_REGEX.test(tzRaw) ? tzRaw : 'America/Bogota';

  if (!startDate || !endDate) throw new ValidationError('startDate y endDate son requeridos');
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
    throw new ValidationError('Fechas en formato YYYY-MM-DD');
  }
  const rangoFiltro = { startDate, endDate, advisorId: advisorId || null, tipo: tipo || null };
  // Guía cuyo correo no está en GUIAS: lista vacía, nunca la de todos.
  if (soloPropios && !advisorId) {
    return successResponse({ items: [], total: 0, soloPropios, puedeAutorizar: false, rangoFiltro });
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
     LEFT JOIN "GUIAS" adv ON adv."_id" = ae."advisorId"
     WHERE ${conds.join(' AND ')}
     ORDER BY ae."fechaInicio" DESC, adv."nombreCompleto" ASC NULLS LAST
     LIMIT 2000`,
    params,
  );

  // Columna "Autoriza": cuáles ya vencieron para el guía y cuáles autorizó Coordinación.
  const autorizadas = await autorizacionesDe('EVENTO_ADMIN', rows.map(r => r.eventoId));
  const ahora = new Date();
  const items = rows.map(r => ({
    ...r,
    vencido: eventoAdminVencido(r.fechaInicio, Number(r.horas), ahora),
    autorizado: autorizadas.has(r.eventoId),
    autorizadoPor: autorizadas.get(r.eventoId)?.autorizadoPorNombre || autorizadas.get(r.eventoId)?.autorizadoPor || null,
    autorizadoEn: autorizadas.get(r.eventoId)?.autorizadoEn || null,
  }));

  return successResponse({
    items, total: items.length, soloPropios,
    puedeAutorizar: await puedeAutorizarGestion(session),
    rangoFiltro,
  });
});
