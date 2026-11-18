import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { ComercialPermission } from '@/types/permissions';
import { getSessionComercialScope } from '@/lib/crm';
import { normalizeNumeroId } from '@/lib/numeroid-normalize';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

/**
 * Comercial › Gestión Contrato › pestaña "Abonos Inscripción".
 *
 * GET  ?contrato=&numeroId=  → busca el TITULAR por número de contrato + su ID y
 *                              devuelve lo que el modal de pago necesita.
 * POST { idPeople, ...pago } → registra un abono a la inscripción (cuota #0).
 *
 * Es el mismo pago de Recaudos (PAGOS_TITULARES) con tres diferencias: sin Último
 * Pago / Penalidad / Cambio Contado, siempre cuota 0, y queda a nombre del
 * COMERCIAL que lo registra (su usuario es el "gestor" del pago, igual que la
 * cuota #0 que crea el contrato). Entra a Recaudos › Verificación Inscripción.
 * Permiso propio; y un líder sólo opera titulares de su equipo.
 */

async function titularDelAlcance(session: any, where: string, params: any[]) {
  const scope = await getSessionComercialScope(session);
  let scopeSql = '';
  if (!scope.seeAll) {
    params.push(scope.equipo);
    scopeSql = ` AND ARRAY[LOWER(COALESCE("liderComercialCorreo",'')), LOWER(COALESCE("asesorMail",'')), LOWER(TRIM(COALESCE("asesor",'')))] && $${params.length}::text[]`;
  }
  return queryOne<any>(
    `SELECT "_id","numeroId","plataforma","primerNombre","segundoNombre","primerApellido","segundoApellido",
            "contrato","gestorRecaudo","_createdDate","inicioContrato","fechaContrato"
       FROM "PEOPLE"
      WHERE "tipoUsuario" = 'TITULAR' AND ${where}${scopeSql}
      LIMIT 1`,
    params
  );
}

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO_ABONO_INSCRIPCION);

  const sp = new URL(request.url).searchParams;
  const contrato = (sp.get('contrato') || '').trim();
  const numeroId = normalizeNumeroId(sp.get('numeroId') || '');
  if (!contrato) throw new ValidationError('Escribe el número de contrato');
  if (!numeroId) throw new ValidationError('Escribe el ID del titular');

  const titular = await titularDelAlcance(
    session,
    `UPPER(TRIM("contrato")) = UPPER($1) AND UPPER(REGEXP_REPLACE("numeroId", '[.\\s\\-_]', '', 'g')) = $2`,
    [contrato, numeroId]
  );
  if (!titular) {
    throw new NotFoundError('Titular', `${contrato} / ${numeroId}`);
  }

  const pagos = await pagosTitularesService.listByPerson(titular._id);
  const fin = await queryOne<{ saldo: string | null }>(
    `SELECT "saldo" FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`, [titular.contrato]);
  const saldo = Number(String(fin?.saldo ?? '0').replace(/[^0-9.\-]/g, '')) || 0;

  const u: any = session.user;
  return successResponse({ titular, pagos, saldo, realizadoPor: u?.name || u?.email || '' });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO_ABONO_INSCRIPCION);

  const body = await request.json();
  const idPeople = String(body?.idPeople || '').trim();
  if (!idPeople) throw new ValidationError('Falta el titular');

  const titular = await titularDelAlcance(session, `"_id" = $1`, [idPeople]);
  if (!titular) throw new ValidationError('No se encontró el titular (o está fuera de tu equipo).');

  const u: any = session.user;
  const email = u?.email || 'unknown';

  // Lo que NO se acepta del cliente: la cuota (siempre 0 = inscripción), el
  // Cambio Contado y la atribución. El gestor es el usuario de la sesión.
  const pago = await pagosTitularesService.create({
    ...body,
    idPeople,
    numCuota: 0,
    cambioContado: false,
    nota: typeof body?.nota === 'string' ? body.nota : null,
    realizadopor: undefined,
    gestorRecaudo: u?.id || null,
  }, email);

  // Un abono a la inscripción es siempre "abono": así se ve en Verificación.
  await query(`UPDATE "PAGOS_TITULARES" SET "abono" = true WHERE "_id" = $1`, [pago._id]);

  return successResponse({ pago }, 201);
});
