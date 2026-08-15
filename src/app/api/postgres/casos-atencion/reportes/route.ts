import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { crearReporte, casosAbiertosDeAlumno } from '@/services/casos-atencion.service';

/**
 * Reportes de Casos de Atención — se crean SÓLO desde aquí (R1) y son
 * inmutables (R4): no hay PATCH ni DELETE.
 *
 * GET  ?academicaId=X  → casos abiertos del alumno, para que el panel del guía
 *                        sepa de antemano si tendrá que preguntar el destino.
 * POST { academicaId, texto, tema, eventoId?, bookingId?, destino? }
 *      Si el alumno tiene casos abiertos y no viene `destino`, responde 409 con
 *      `detail.tipo = 'caso_abierto'` y la lista, sin escribir nada: el panel
 *      muestra el modal "¿sumar al caso abierto o abrir uno nuevo?" (R2).
 *
 * El guía se toma de la sesión, no del body: el autor del reporte no se elige.
 */

export const GET = handlerWithAuth(async (request) => {
  const academicaId = new URL(request.url).searchParams.get('academicaId') || '';
  if (!academicaId.trim()) throw new ValidationError('Falta academicaId.');
  const casosAbiertos = await casosAbiertosDeAlumno(academicaId.trim());
  return successResponse({ academicaId, casosAbiertos, total: casosAbiertos.length });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const body = await request.json().catch(() => ({}));
  const u = (session as any)?.user || {};

  const r = await crearReporte({
    academicaId: body?.academicaId,
    texto: body?.texto,
    tema: body?.tema,
    eventoId: body?.eventoId ?? null,
    bookingId: body?.bookingId ?? null,
    // Autor = quien está logueado.
    guiaId: u.id ?? null,
    guiaNombre: u.name || u.email || null,
    destino: body?.destino ?? null,
  });

  return successResponse({
    ...r,
    message: r.abrioCaso
      ? `Reporte enviado. Se abrió el caso ${r.codigo}.`
      : `Reporte agregado al caso ${r.codigo}.`,
  });
});
