import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requireAnyPermission, tienePermiso } from '@/lib/api-permissions';
import { ComercialPermission, PersonPermission } from '@/types/permissions';
import {
  obtenerRecibo, registrarRecibo, registrarDosRecibos, procesarLectura, cargarTitular,
} from '@/services/recibo-inscripcion.service';

/**
 * Recibo de inscripción del contrato (vive en el titular; si llega el id de un
 * beneficiario se resuelve su titular).
 *
 *   GET  → { recibo, historial, inscripcion, coincide, puedeSubir, puedeLeer }
 *   POST { url, nombre, tipo } → registra el recibo (el anterior pasa al historial)
 *        y lo lee con IA. El archivo se sube antes por upload-url (proposito=recibo).
 *        Dos recibos: { dosRecibos: true, recibos: [{url,nombre,tipo},{…}], montoManual }
 *
 * Ver el recibo NO exige el permiso de subirlo (en LGS sí, y quien no podía
 * subirlo tampoco veía el que ya estaba).
 */

const PUEDE_VER = [
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.ADICION_DOCUMENTACION,
  ComercialPermission.MODIFICAR_CONTRATO,
  PersonPermission.PAGOS_VER,
  ComercialPermission.SUBIR_RECIBO_INSCRIPCION,
  PersonPermission.LEER_RECIBO,
];

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requireAnyPermission(session, PUEDE_VER);
  const datos = await obtenerRecibo(params.id);
  const [puedeSubir, puedeLeer] = await Promise.all([
    tienePermiso(session, ComercialPermission.SUBIR_RECIBO_INSCRIPCION),
    tienePermiso(session, PersonPermission.LEER_RECIBO),
  ]);
  return successResponse({ ...datos, puedeSubir: puedeSubir || puedeLeer, puedeLeer });
});

export const POST = handlerWithAuth(async (req, { params }, session) => {
  // Subir el recibo: quien crea el contrato (SUBIR_RECIBO) o Recaudos (LEER_RECIBO),
  // que a veces recibe el comprobante por otro canal.
  await requireAnyPermission(session, [
    ComercialPermission.SUBIR_RECIBO_INSCRIPCION,
    PersonPermission.LEER_RECIBO,
  ]);
  const body = await req.json().catch(() => ({}));
  const actor = (session?.user?.email as string) || 'desconocido';
  const titular = await cargarTitular(params.id);
  const texto = (v: unknown, max: number) => (v ? String(v).slice(0, max) : null);

  if (body?.dosRecibos === true) {
    // "El pago tiene dos recibos": los dos archivos + el monto total digitado.
    const lista = Array.isArray(body?.recibos) ? body.recibos : [];
    if (lista.length !== 2 || lista.some((r: any) => !String(r?.url || '').trim())) {
      throw new ValidationError('Adjunta el recibo 1 y el recibo 2.');
    }
    await registrarDosRecibos({
      peopleId: titular._id,
      recibos: lista.map((r: any) => ({
        url: String(r.url).trim(), nombre: texto(r.nombre, 200), tipo: texto(r.tipo, 100),
      })),
      montoManual: Number(body?.montoManual),
      actor,
    });
  } else {
    const url = String(body?.url || '').trim();
    if (!url) throw new ValidationError('url del recibo es requerida.');
    await registrarRecibo({
      peopleId: titular._id, url, nombre: texto(body?.nombre, 200), tipo: texto(body?.tipo, 100), actor,
    });
  }
  // El recibo ya quedó guardado: si la lectura falla, queda marcado como FALLIDA.
  const r = await procesarLectura(titular._id, actor);
  return successResponse({
    ...r,
    message: r.recibo.lectura === 'OK'
      ? 'Recibo guardado y leído.'
      : `Recibo guardado, pero no se pudo leer: ${r.recibo.lecturaError}`,
  });
});
