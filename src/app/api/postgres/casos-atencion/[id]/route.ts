import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import {
  getCasoDetalle, cambiarEstado, agregarContacto, guardarGestion, marcarReportesLeidos,
  type EstadoCaso,
} from '@/services/casos-atencion.service';
import { recalcularEnSegundoPlano, resolverReincidenciaInmediata } from '@/services/casos-reincidencia.service';

/**
 * Detalle y gestión de un Caso de Atención.
 *
 * GET    → el caso completo: reportes, intentos de contacto, historial de
 *          estados, otros casos abiertos del alumno y su histórico de cerrados.
 *          Al abrirlo marca los reportes como leídos (R7).
 * PATCH  → gestión. Tres acciones, según lo que traiga el body:
 *            { estado, motivo? }                       cambia el estado (cierra, R5)
 *            { contacto: {canal, resultado, obs?} }    agrega un intento (R8)
 *            { acuerdo?, fechaCompromiso?, ... }       guarda acuerdo / finanzas
 *
 * No hay DELETE: los casos no se borran, se cierran cambiando de estado.
 */

export const GET = handlerWithAuth(async (_request, ctx: any, session) => {
  const id = String(ctx?.params?.id || '').trim();
  if (!id) throw new ValidationError('Falta el id del caso.');

  // Primer caso del alumno: la reincidencia es BAJA por definición y se resuelve
  // aquí mismo (dos queries) para que la ficha no se abra en "Calculando…".
  // Si hay historial devuelve null y el cálculo con IA queda para el background.
  await resolverReincidenciaInmediata(id).catch(() => null);

  const detalle = await getCasoDetalle(id);

  // R7: abrir el caso es lo que marca sus reportes como leídos. Best-effort —
  // que falle el marcado no debe impedir ver el caso.
  const u = (session as any)?.user || {};
  const leidos = await marcarReportesLeidos(id, { email: u.email, nombre: u.name })
    .catch(() => ({ marcados: 0 }));

  // La reincidencia se recalcula al abrir el caso, pero SIN esperarla: si
  // bloqueara, abrir un caso esperaría a OpenAI. Se devuelve lo último
  // calculado y el valor nuevo aparece al siguiente refresco.
  recalcularEnSegundoPlano(id);

  return successResponse({ ...detalle, reportesMarcadosLeidos: leidos.marcados });
});

export const PATCH = handlerWithAuth(async (request, ctx: any, session) => {
  const id = String(ctx?.params?.id || '').trim();
  if (!id) throw new ValidationError('Falta el id del caso.');

  const body = await request.json().catch(() => ({}));
  const u = (session as any)?.user || {};
  const actor = { email: u.email ?? null, nombre: u.name ?? null };

  if (body?.contacto) {
    const c = await agregarContacto(id, {
      canal: body.contacto.canal,
      resultado: body.contacto.resultado,
      observacion: body.contacto.observacion ?? null,
    }, actor);
    return successResponse({ contacto: c, message: `Intento ${c.intento} de ${c.canal} registrado.` });
  }

  if (body?.estado) {
    const r = await cambiarEstado(id, String(body.estado) as EstadoCaso, actor, body.motivo);
    return successResponse({
      ...r,
      message: r.cerrado ? 'Caso cerrado y enviado al histórico.' : 'Sin cambios.',
    });
  }

  // Acuerdo / finanzas: sólo se tocan los campos enviados.
  const g = await guardarGestion(id, {
    acuerdo: body?.acuerdo,
    fechaCompromiso: body?.fechaCompromiso,
    responsable: body?.responsable,
    seguimientoFinanzas: body?.seguimientoFinanzas,
  });
  return successResponse({ ...g, message: 'Gestión guardada.' });
});
