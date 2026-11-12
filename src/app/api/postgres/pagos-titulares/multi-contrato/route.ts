/**
 * API: /api/postgres/pagos-titulares/multi-contrato  ("Pago Especial › Pago titular con
 * más de una matrícula")
 *
 * GET  ?numeroId=...   → contratos del titular con lo necesario para repartir un pago
 *                         (valor de cuota, saldo, primera cuota incompleta y valor sugerido).
 * POST { numeroId, items:[{idPeople,numCuota,valorPagado,descuento?}], ... } → crea UN pago
 *      normal por cada contrato marcado. Todos comparten recibos, referencia y fecha, y
 *      llevan una nota que los enlaza. Entran a Verificación y Facturación como cualquier otro.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';
import { normalizeNumeroId } from '@/lib/numeroid-normalize';
import { asignarPagos } from '@/lib/cuotas-pagos';
import { pagosTitularesService } from '@/services/pagos-titulares.service';
import { computePlataformaScope, getSessionPlataforma, buildPlataformaWhereSql } from '@/lib/recaudos-scope';

const toNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const ESTADOS_NO_PAGABLES = ['contrato nulo', 'devuelto', 'rechazado', 'retractado'];

async function contratosDelTitular(numeroId: string, session: any) {
  const doc = normalizeNumeroId(numeroId);
  if (!doc) throw new ValidationError('Digita el ID del titular');

  const email = (session?.user as any)?.email;
  const scope = computePlataformaScope((session?.user as any)?.role, await getSessionPlataforma(email));
  const w = buildPlataformaWhereSql(scope, 'p."plataforma"', 2);

  const titulares = await queryMany<any>(
    `SELECT p."_id", p."contrato", p."primerNombre", p."primerApellido", p."numeroId", p."plataforma",
            p."gestorRecaudo", p."aprobacion", p."estado", p."estadoInactivo"
       FROM "PEOPLE" p
      WHERE p."tipoUsuario" = 'TITULAR'
        AND UPPER(REGEXP_REPLACE(COALESCE(p."numeroId",''), '[.[:space:]_-]', '', 'g')) = $1
        AND COALESCE(p."contrato",'') <> '' AND p."contrato" NOT LIKE 'PRB-%'
        ${w.sql}
      ORDER BY p."_createdDate" ASC`,
    [doc, ...w.params],
  );

  const out: any[] = [];
  for (const t of titulares) {
    const aprob = String(t.aprobacion || '').trim().toLowerCase();
    if (ESTADOS_NO_PAGABLES.includes(aprob)) continue;
    if (String(t.estado || '').toUpperCase() === 'FINALIZADA') continue;

    const fin = await queryMany<any>(
      `SELECT "totalPlan","valorCuota","numeroCuotas","pagoInscripcion","saldo","cuotasPagadas"
         FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`, [t.contrato]);
    const f = fin[0];
    if (!f) continue; // sin plan financiero no hay a qué aplicar el pago

    const pagos = await queryMany<any>(
      `SELECT "_id","numCuota","fechaPago","_createdDate","valorPagado","descuento","inscripcion","validado"
         FROM "PAGOS_TITULARES" WHERE "idPeople" = $1`, [t._id]);
    const valorCuota = toNum(f.valorCuota);
    const numeroCuotas = parseInt(String(f.numeroCuotas ?? 0), 10) || 0;
    const asig = valorCuota > 0 && numeroCuotas > 0
      ? asignarPagos({ inscripcion: toNum(f.pagoInscripcion), valorCuota, numeroCuotas, pagos })
      : null;
    const maxCuota = pagos.reduce((m: number, x: any) => Math.max(m, Number(x.numCuota) || 0), 0);
    const primera = asig?.primeraIncompleta != null && asig.primeraIncompleta >= 1 ? asig.primeraIncompleta : maxCuota + 1;
    const saldo = Math.max(0, toNum(f.saldo));
    const faltaCuota = asig?.cuotas[primera] ? Math.round(asig.cuotas[primera].falta) : Math.round(valorCuota);
    const sugerido = Math.max(0, Math.min(faltaCuota > 0 ? faltaCuota : Math.round(valorCuota), Math.round(saldo)));

    out.push({
      idPeople: t._id,
      contrato: t.contrato,
      titular: `${t.primerNombre || ''} ${t.primerApellido || ''}`.trim(),
      plataforma: t.plataforma,
      gestorRecaudo: t.gestorRecaudo,
      aprobacion: t.aprobacion,
      estado: t.estado,
      totalPlan: toNum(f.totalPlan),
      valorCuota,
      numeroCuotas,
      cuotasPagadas: parseInt(String(f.cuotasPagadas ?? 0), 10) || 0,
      saldo,
      numCuota: primera,
      sugerido,
    });
  }
  return out;
}

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  await requirePermission(session, PersonPermission.PAGO_ESPECIAL);
  const numeroId = new URL(req.url).searchParams.get('numeroId') || '';
  const contratos = await contratosDelTitular(numeroId, session);
  return successResponse({ contratos, total: contratos.length });
});

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  await requirePermission(session, PersonPermission.PAGO_ESPECIAL);

  const body = await req.json();
  const createdBy = (session.user as any)?.email || 'unknown';
  const items: any[] = Array.isArray(body.items) ? body.items : [];
  if (items.length < 1) throw new ValidationError('Marca al menos un contrato');
  if (!body.fechaPago) throw new ValidationError('Fecha de pago es requerida');

  const total = Math.round(toNum(body.valorTotal));
  if (total <= 0) throw new ValidationError('Digita el valor total del pago');
  const repartido = Math.round(items.reduce((s, i) => s + toNum(i.valorPagado), 0));
  if (repartido !== total) {
    throw new ValidationError(`El reparto ($${repartido.toLocaleString('es-CL')}) no coincide con el total pagado ($${total.toLocaleString('es-CL')})`);
  }
  if (items.some(i => toNum(i.valorPagado) <= 0)) throw new ValidationError('Cada contrato marcado debe tener un valor mayor a 0');

  // Sólo contratos de ESE titular (y dentro del alcance del usuario): el servidor lo
  // vuelve a resolver, no se fía de los idPeople que mande el navegador.
  const validos = await contratosDelTitular(String(body.numeroId || ''), session);
  const porId = new Map(validos.map(c => [c.idPeople, c]));
  const vistos = new Set<string>();
  for (const i of items) {
    if (!porId.has(i.idPeople)) throw new ValidationError('Uno de los contratos no pertenece a ese titular o no admite pagos');
    if (vistos.has(i.idPeople)) throw new ValidationError('Un contrato está repetido en el reparto');
    vistos.add(i.idPeople);
  }

  const dosRecibos = body.dosRecibos === true;
  const docs = Array.isArray(body.documentosAdjuntos) ? body.documentosAdjuntos : [];
  if (dosRecibos) {
    const tiene = (n: number) => docs.some((d: any) => Number(d?.recibo) === n && d?.url);
    if (!tiene(1) || !tiene(2)) throw new ValidationError('Marcaste "dos recibos": adjunta el recibo 1 y el recibo 2');
  }

  const resumen = items
    .map(i => `${porId.get(i.idPeople)!.contrato} $${Math.round(toNum(i.valorPagado)).toLocaleString('es-CL')}`)
    .join(' · ');
  const notaUsuario = typeof body.nota === 'string' ? body.nota.trim() : '';
  const nota = `Pago conjunto de ${items.length} contrato(s) por $${total.toLocaleString('es-CL')}: ${resumen}.` + (notaUsuario ? ` ${notaUsuario}` : '');

  const creados: any[] = [];
  try {
    for (const i of items) {
      const c = porId.get(i.idPeople)!;
      const pago = await pagosTitularesService.create({
        idPeople: i.idPeople,
        gestorRecaudo: c.gestorRecaudo ?? null,
        plataforma: c.plataforma ?? null,
        pagoTercero: body.pagoTercero || null,
        idTercero: body.idTercero || null,
        fechaPago: body.fechaPago,
        fechaReporte: body.fechaReporte || null,
        vlrTotalProg: c.totalPlan || null,
        numCuota: Number.isFinite(Number(i.numCuota)) ? Number(i.numCuota) : c.numCuota,
        valorCuota: c.valorCuota || null,
        valorPagado: toNum(i.valorPagado),
        descuento: toNum(i.descuento),
        medioPago: body.medioPago || null,
        numeroReferencia: body.numeroReferencia || null,
        banco: body.banco || null,
        documentosAdjuntos: docs,
        dosRecibos,
        nota,
      } as any, createdBy);
      creados.push(pago);
    }
  } catch (err: any) {
    // Los ya creados quedan registrados: se informa cuáles para no duplicarlos al reintentar.
    const hechos = creados.length ? ` Ya se registraron ${creados.length} (${creados.map((p: any) => porId.get(p.idPeople)?.contrato).join(', ')}); no los repitas.` : '';
    throw new ValidationError(`${err?.message || 'Error al registrar'}.${hechos}`);
  }
  return successResponse({ pagos: creados, total: creados.length }, 201);
});
