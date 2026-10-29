import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { getSessionComercialScope } from '@/lib/crm';
import { motivoNoDableDeBaja, purgarContrato } from '@/services/purga-contrato.service';

/**
 * POST /api/postgres/matriculas/delete
 *   body: { ids: string[] (PEOPLE._id de titulares), motivo: string }
 *
 * "Borrar matrícula" de Comercial › Matrículas (traído de LGS): borra en cascada
 * contratos **SIN FIRMAR** — titular sin consentimiento y sin decisión de
 * aprobación.
 *
 * ⚠ A diferencia de LGS NO borra los accesos por correo: aquí los hermanos
 * comparten el correo del apoderado y eso se llevaría la cuenta de un alumno de
 * otro contrato. Usa `purgarContrato` (el mismo de Gestión Contrato › Dar de
 * baja), que borra por `userLogin`/documento, conserva a quien está en otro
 * contrato y deja la copia completa en PURGE_LOG antes de tocar nada.
 *
 * Guardas (server-side): permiso propio, alcance por líder, sin firma, sin
 * decisión, no marcado listo (ya tomó el cupo), no de prueba, motivo obligatorio,
 * máx. 50 por operación.
 */
const MAX = 50;

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.MATRICULAS_BORRAR);

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  const motivo = String(body?.motivo || '').trim();
  if (!ids.length) throw new ValidationError('No hay matrículas seleccionadas.');
  if (!motivo) throw new ValidationError('El motivo es obligatorio.');
  if (ids.length > MAX) throw new ValidationError(`Máximo ${MAX} matrículas por operación.`);

  const scope = await getSessionComercialScope(session);
  const actorEmail = (session as any)?.user?.email || 'desconocido';
  const ipRaw = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
  const ctx = {
    tipoPurga: 'MATRICULA_SIN_FIRMAR',
    motivo: `[Matrículas] ${motivo}`,
    actorEmail,
    actorNombre: (session as any)?.user?.name ?? null,
    ip: ipRaw.split(',')[0].trim().slice(0, 45),
    userAgent: request.headers.get('user-agent') || '',
  };

  const results: { titularId: string; contrato: string; status: 'ok' | 'rechazado' | 'error'; error?: string }[] = [];

  for (const id of ids) {
    const t = await queryOne<any>(
      `SELECT "_id","contrato","aprobacion","hashConsentimiento","gestionContratoListo","liderComercialCorreo","asesorMail","asesor"
         FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [id]);
    if (!t || !t.contrato) { results.push({ titularId: id, contrato: id, status: 'rechazado', error: 'No se encontró el titular o no tiene contrato.' }); continue; }

    const rechazo =
      /^PRB-/i.test(t.contrato) ? 'Es un contrato de prueba (se purga en Mantenimiento › Contratos de prueba).'
      : !scope.seeAll && ![t.liderComercialCorreo, t.asesorMail, t.asesor].some((v: any) => scope.equipo.includes(String(v || '').trim().toLowerCase()))
        ? 'Fuera de tu equipo comercial.'
      : String(t.hashConsentimiento || '').trim() ? 'El contrato ya está FIRMADO; sólo se borran matrículas sin firmar.'
      : String(t.aprobacion || '').trim() ? `El contrato tiene estado "${t.aprobacion}"; sólo se borran matrículas sin decisión.`
      : motivoNoDableDeBaja(t)?.mensaje || null;
    if (rechazo) { results.push({ titularId: id, contrato: t.contrato, status: 'rechazado', error: rechazo }); continue; }

    try {
      await purgarContrato(t.contrato, ctx);
      results.push({ titularId: id, contrato: t.contrato, status: 'ok' });
    } catch (err: any) {
      console.error(`[matriculas/delete] ${t.contrato}:`, err?.message || err);
      results.push({ titularId: id, contrato: t.contrato, status: 'error', error: err?.message || 'Error desconocido' });
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const rechazados = results.filter(r => r.status === 'rechazado').length;
  const failed = results.filter(r => r.status === 'error').length;
  return successResponse({
    message: `Borrado: ${ok} OK · ${rechazados} rechazados · ${failed} fallidos`,
    results, ok, rechazados, failed, total: results.length,
  });
});
