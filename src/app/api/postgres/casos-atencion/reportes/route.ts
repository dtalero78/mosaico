import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { crearReporte, casosAbiertosDeAlumno, guiaDeSesion } from '@/services/casos-atencion.service';
import { requirePermission } from '@/lib/api-permissions';
import { ServicioPermission } from '@/types/permissions';
import { queryOne } from '@/lib/postgres';

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
 * El guía se toma de la SESIÓN. Única excepción: Servicio, al adicionar un caso
 * desde su informe, puede indicar `guiaId` para atribuirle la observación al guía
 * que se la reportó por teléfono o WhatsApp. Eso exige el permiso de gestión
 * —validado aquí, no ocultando el dropdown— y deja registrado en el reporte
 * quién lo tecleó, para que se sepa quién firmó a nombre de quién.
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

  // `guiaId` debe ser el GUIAS._id, no el de la sesión (que es USUARIOS_ROLES):
  // es lo que compara el filtro "sólo mis casos" del listado. Si quien reporta
  // no es un guía (un coordinador, por ejemplo), queda null y basta el nombre.
  const guia = await guiaDeSesion(u.email);

  // Atribuir el reporte a OTRO guía: sólo Servicio, y se comprueba que el guía
  // exista de verdad — un id inventado dejaría el caso firmado por nadie.
  const guiaPedido = String(body?.guiaId || '').trim();
  const atribuyeAOtro = !!guiaPedido && guiaPedido !== guia?._id;
  let autor = guia;
  if (atribuyeAOtro) {
    await requirePermission(session, ServicioPermission.CASOS_ATENCION_GESTION as any);
    const g = await queryOne<{ _id: string; nombreCompleto: string | null }>(
      `SELECT "_id","nombreCompleto" FROM "GUIAS" WHERE "_id" = $1 LIMIT 1`, [guiaPedido]
    );
    if (!g) throw new ValidationError('El guía indicado no existe.');
    autor = g;
  }

  // Sin sesión de la que colgarse (el alta de Servicio) el reporte se ancla a la
  // ÚLTIMA clase del alumno. No es un adorno: el informe Servicio › Casos de
  // Atención sigue leyendo el modelo plano `ACADEMICA_BOOKINGS.casoAtencion`, que
  // sólo se marca cuando hay agendamiento — sin ancla, el caso se crearía y no
  // aparecería en la pantalla desde la que se acaba de crear.
  // El orden de preferencia importa:
  //  1º una clase SIN anotación — el reporte escribe `advisorAnotaciones`, y
  //     anclarlo a una clase que ya la tiene borraría lo que escribió el guía.
  //  2º una clase del guía al que se atribuye: la observación es suya, así no
  //     aterriza en la clase de otro.
  //  3º la más reciente.
  let bookingId = body?.bookingId ?? null;
  let eventoId = body?.eventoId ?? null;
  if (!bookingId && body?.academicaId) {
    const ult = await queryOne<{ _id: string; eventoId: string | null }>(
      `SELECT b."_id", COALESCE(b."eventoId", b."idEvento") AS "eventoId"
         FROM "ACADEMICA_BOOKINGS" b
         LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
        WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
          AND b."cancelo" IS NOT TRUE
          AND b."fechaEvento" <= NOW()
        ORDER BY (COALESCE(b."advisorAnotaciones",'') = '') DESC,
                 (c."advisor" = $2) DESC NULLS LAST,
                 b."fechaEvento" DESC
        LIMIT 1`,
      [String(body.academicaId).trim(), autor?._id ?? null]
    );
    if (ult) { bookingId = ult._id; eventoId = eventoId || ult.eventoId; }
  }

  const r = await crearReporte({
    academicaId: body?.academicaId,
    texto: body?.texto,
    tema: body?.tema,
    eventoId,
    bookingId,
    // Autor = quien está logueado, salvo que Servicio lo atribuya a otro guía.
    guiaId: autor?._id ?? null,
    // El nombreCompleto de GUIAS, no session.user.name — ese trae sólo el
    // nombre de pila y el reporte quedaría firmado a medias.
    guiaNombre: autor?.nombreCompleto || (atribuyeAOtro ? null : (u.name || u.email)) || null,
    // Sólo cuando el autor y quien captura son personas distintas: si reporta el
    // propio guía no hay nada que distinguir.
    registradoPor: atribuyeAOtro ? (u.name || u.email || null) : null,
    registradoPorEmail: atribuyeAOtro ? (u.email || null) : null,
    destino: body?.destino ?? null,
  });

  return successResponse({
    ...r,
    message: r.abrioCaso
      ? `Reporte enviado. Se abrió el caso ${r.codigo}.`
      : `Reporte agregado al caso ${r.codigo}.`,
  });
});
