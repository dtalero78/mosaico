import 'server-only';
import { query, queryOne } from '@/lib/postgres';

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
