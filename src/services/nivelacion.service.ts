import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { ConflictError } from '@/lib/errors';
import {
  armarNivelacionViva, mensajeNivelacionSinResolver, TIPO_NIVELACION_SIN_RESOLVER,
  type NivelacionViva,
} from '@/lib/nivelacion-viva';
import { agendamientoDeNivelacionActualDe } from '@/services/nivelacion-agendada.service';

/** Lo mínimo que se necesita del cliente de la transacción (evita importar `pg`). */
interface ClienteSql {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

/**
 * La nivelación viva del usuario (pedida o aprobada, sin cerrar), con la pestaña
 * en la que está. `null` si no tiene ninguna.
 *
 * Que ya tenga evento se resuelve con la misma regla que parte Agrupaciones de
 * Pendientes (`agendamientoDeNivelacionActualDe`): sólo cuenta el agendamiento
 * creado después de la solicitud.
 */
export async function nivelacionVivaDe(academicaId: string): Promise<NivelacionViva | null> {
  const row = await queryOne<any>(
    `SELECT a."nivelacion", a."aprobadoNivelacion", a."detalleNivelacion",
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ',
              COALESCE(NULLIF(TRIM(p."primerNombre"), ''), a."primerNombre"),
              COALESCE(NULLIF(TRIM(p."primerApellido"), ''), a."primerApellido")), '\\s+', ' ', 'g')) AS nombre
       FROM "ACADEMICA" a
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE a."_id" = $1`,
    [academicaId]
  );
  if (!row || (row.nivelacion !== true && row.aprobadoNivelacion !== true)) return null;

  let agendamiento = null;
  if (row.aprobadoNivelacion === true) {
    const det = row.detalleNivelacion && typeof row.detalleNivelacion === 'object' ? row.detalleNivelacion : null;
    agendamiento = await agendamientoDeNivelacionActualDe(academicaId, det?.fecha ?? null);
  }
  return armarNivelacionViva({
    nivelacion: row.nivelacion,
    aprobadoNivelacion: row.aprobadoNivelacion,
    detalle: row.detalleNivelacion,
    nombre: row.nombre,
    tieneEvento: !!agendamiento,
    fechaEvento: agendamiento?.eventoDia ?? null,
  });
}

/** El 409 de "ya tiene una sin resolver", con el detalle que abre el modal. */
export function errorNivelacionSinResolver(viva: NivelacionViva): ConflictError {
  return new ConflictError(mensajeNivelacionSinResolver(viva), { tipo: TIPO_NIVELACION_SIN_RESOLVER, ...viva });
}

/**
 * Rechaza pedir una nivelación a quien ya tiene una viva. Lo usan las DOS vías
 * que crean una solicitud a mano: la casilla del guía y el alta de Servicio.
 */
export async function assertSinNivelacionViva(academicaId: string): Promise<void> {
  const viva = await nivelacionVivaDe(academicaId);
  if (viva) throw errorNivelacionSinResolver(viva);
}

/**
 * Deja la SOLICITUD en regla cuando a un alumno lo agendan DIRECTAMENTE en un
 * evento de nivelación (desde el calendario o desde "Agendar Nueva Clase" de la
 * ficha), sin pasar por Solicitudes → Aprobar → Agrupaciones.
 *
 * El módulo entero se mueve por la solicitud de `ACADEMICA` (`nivelacion`,
 * `aprobadoNivelacion`, `detalleNivelacion`), no por el agendamiento: sin ella
 * el alumno no sale en Pendientes, su panel no le ofrece confirmar asistencia
 * (se confirma la solicitud, no el evento) y el cierre no tiene qué cerrar. Así
 * quedaron NATANIEL PEDREGAL y AMELIA ROSAS el 25-sep-2026 — y se regularizaron
 * a mano con `scripts/regularizar-nivelacion-agendada-sin-solicitud.js`, que
 * escribe exactamente lo mismo que esto.
 *
 * Por alumno, según cómo esté su solicitud:
 *  - PEDIDA y sin aprobar (`nivelacion=true`) → se APRUEBA: el agendamiento
 *    directo es la aprobación de hecho. Se conservan su detalle y su conteo.
 *  - ya APROBADA → nada: con el agendamiento pasa sola a Pendientes.
 *  - SIN solicitud viva → se CREA aprobada, con módulo/lección/hora del EVENTO,
 *    conteo +1, el guía del evento como solicitante y quien agenda como
 *    registrador.
 *
 * La `fecha` de la solicitud nueva se toma del RELOJ DE LA BASE, un minuto
 * antes de `NOW()`: el agendamiento se inserta con `_createdDate = NOW()` en la
 * misma transacción, y la regla "ya tiene evento" exige que el agendamiento sea
 * posterior a la solicitud (`lib/nivelacion-agendamiento`). Con la hora del
 * proceso, una transacción lenta podía dejar la solicitud DESPUÉS del
 * agendamiento y al alumno colgado en Agrupaciones.
 *
 * Se llama DENTRO de la transacción del agendamiento: un agendamiento sin
 * solicitud es justo lo que se quiere impedir, así que van juntos o no van.
 * Ids que no sean de ACADEMICA (un PEOPLE sin registro académico) no coinciden
 * con nada y se ignoran.
 */
export async function registrarSolicitudPorAgendamientoDirecto(
  client: ClienteSql,
  input: { eventoId: string; academicaIds: string[]; agendadoPor?: string | null; agendadoPorEmail?: string | null }
): Promise<{ aprobadas: number; creadas: number }> {
  const ids = Array.from(new Set(input.academicaIds.filter(Boolean)));
  if (!ids.length) return { aprobadas: 0, creadas: 0 };

  const ev = (await client.query(
    `SELECT c."nivel", c."step", c."duracionMin",
            TO_CHAR(c."dia" AT TIME ZONE 'America/Santiago', 'HH24:MI') AS hora_chile,
            g."email" AS guia_email
       FROM "CALENDARIO" c LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE c."_id" = $1 AND UPPER(COALESCE(c."tipo", c."evento", '')) = 'NIVELACION'`,
    [input.eventoId]
  )).rows[0];
  if (!ev) return { aprobadas: 0, creadas: 0 };

  // 1) Pedida y sin aprobar → aprobar (conserva detalle y conteo).
  const aprobadas = await client.query(
    `UPDATE "ACADEMICA"
        SET "nivelacion" = false, "aprobadoNivelacion" = true, "_updatedDate" = NOW()
      WHERE "_id" = ANY($1::text[]) AND "nivelacion" = true`,
    [ids]
  );

  // 2) Sin solicitud viva → crearla aprobada. `fecha` la pone la base, un minuto
  //    antes de NOW() (ver cabecera). Los que ya estaban aprobados quedan fuera
  //    por el WHERE.
  const detalle = {
    leccion: ev.step || null,
    modulo: ev.nivel || null,
    hora: ev.hora_chile || null,
    duracionMin: Number(ev.duracionMin) > 0 ? Number(ev.duracionMin) : 30,
    motivo: `Agendado directamente en la nivelación por ${input.agendadoPor || 'Servicio'}`,
    marcadoPor: ev.guia_email || null,
    registradoPor: input.agendadoPor || null,
    registradoPorEmail: input.agendadoPorEmail || null,
    origen: 'AGENDAMIENTO_DIRECTO',
  };
  const creadas = await client.query(
    `UPDATE "ACADEMICA"
        SET "nivelacion" = false,
            "aprobadoNivelacion" = true,
            "detalleNivelacion" = $2::jsonb || jsonb_build_object(
              'fecha', to_char((NOW() - INTERVAL '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ),
            "NivelacionCount" = COALESCE("NivelacionCount", 0) + 1,
            "_updatedDate" = NOW()
      WHERE "_id" = ANY($1::text[])
        AND COALESCE("nivelacion", false) = false
        AND COALESCE("aprobadoNivelacion", false) = false`,
    [ids, JSON.stringify(detalle)]
  );

  return { aprobadas: aprobadas.rowCount ?? 0, creadas: creadas.rowCount ?? 0 };
}

/**
 * Cierra la NIVELACIÓN de un alumno si su sesión quedó REALIZADA (asistió + participó).
 *
 * El cierre "oficial" lo hace el Guía en /sesion/[id] (academic-record, con comentario
 * obligatorio). Pero si la asistencia se marca por otra vía (modal admin "Detalles de la
 * Clase", bulk), la nivelación quedaba pendiente para siempre aunque la sesión estuviera
 * asistida+participada. Este helper cierra ese hueco: al marcar la sesión de NIVELACIÓN
 * como asistida Y participada, baja `nivelacion`/`aprobadoNivelacion` a false y agrega
 * REALIZADA a `NivelacionHistory` (conservando el conteo y el módulo/lección reforzado).
 *
 * Solo actúa cuando el evento es NIVELACION y AMBAS (asistió y participó) están en true.
 * Idempotente: si la nivelación ya está cerrada (nivelacion=false), no hace nada.
 */
export async function cerrarNivelacionSiRealizada(bookingId: string, actor: string): Promise<{ cerrada: boolean }> {
  const bk = await queryOne<any>(
    `SELECT b."idEstudiante", b."studentId", b."asistio", b."asistencia", b."participacion",
            c."tipo" AS "evTipo", c."dia"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE b."_id" = $1`, [bookingId]
  );
  if (!bk) return { cerrada: false };
  if (String(bk.evTipo || '').toUpperCase() !== 'NIVELACION') return { cerrada: false };

  const asistio = bk.asistio === true || bk.asistencia === true;
  const participo = bk.participacion === true;
  if (!asistio || !participo) return { cerrada: false };

  const idEstudiante = bk.idEstudiante || bk.studentId;
  if (!idEstudiante) return { cerrada: false };

  const cur = await queryOne<{ nivelacion: boolean | null; NivelacionCount: number | null; detalleNivelacion: any }>(
    `SELECT "nivelacion","NivelacionCount","detalleNivelacion" FROM "ACADEMICA" WHERE "_id" = $1`, [idEstudiante]
  );
  if (!cur || cur.nivelacion !== true) return { cerrada: false }; // ya cerrada / no activa

  let det: any = cur.detalleNivelacion;
  if (typeof det === 'string') { try { det = JSON.parse(det); } catch { det = null; } }

  const entry = {
    fecha: new Date().toISOString(),
    fechaEvento: bk.dia ? new Date(bk.dia).toISOString() : null,
    conteo: Number(cur.NivelacionCount) || 0,
    resultado: 'REALIZADA',
    comentario: 'Cerrada al marcar asistencia (módulo Académica)',
    fechaSolicitud: det?.fecha || null,
    confirmadoEn: det?.confirmadoEn || null,
    confirmadoPor: det?.confirmadoPor || null,
    modulo: det?.modulo || null,
    leccion: det?.leccion || null,
    marcadoPor: actor,
  };
  await query(
    `UPDATE "ACADEMICA"
        SET "nivelacion" = false, "aprobadoNivelacion" = false,
            "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $2::jsonb,
            "_updatedDate" = NOW()
      WHERE "_id" = $1`,
    [idEstudiante, JSON.stringify([entry])]
  ).catch(() => {});
  return { cerrada: true };
}
