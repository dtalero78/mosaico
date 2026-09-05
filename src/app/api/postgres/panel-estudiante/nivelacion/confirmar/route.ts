import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ids } from '@/lib/id-generator';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { puedeConfirmarAlumno, corteConfirmacion, MENSAJE_CONFIRMACION_VENCIDA } from '@/lib/nivelacion-confirmacion';

/**
 * POST /api/postgres/panel-estudiante/nivelacion/confirmar
 *
 * El alumno confirma que asistirá a la nivelación que le pidió su guía.
 *
 * El alumno sale de la SESIÓN, nunca del body: si viniera en el cuerpo,
 * cualquiera podría confirmar la nivelación de otro. Y el plazo se revalida
 * aquí y no sólo escondiendo el botón, que es presentación, no una barrera.
 *
 * Es idempotente: volver a confirmar devuelve la confirmación que ya existe sin
 * pisar quién ni cuándo — el registro de la primera es el que vale.
 */
export const POST = handlerWithAuth(async (_request, _ctx, session) => {
  const student: any = await resolveStudentFromSession(session);
  // OJO: `_id` del perfil combinado es el de PEOPLE; ACADEMICA._id viaja en
  // `academicaId`, que es donde vive la nivelación.
  if (!student?.academicaId) throw new ValidationError('No se encontró tu registro académico');

  const row = await queryOne<{ nivelacion: boolean | null; aprobadoNivelacion: boolean | null; detalleNivelacion: any }>(
    `SELECT "nivelacion", "aprobadoNivelacion", "detalleNivelacion" FROM "ACADEMICA" WHERE "_id" = $1`,
    [student.academicaId]
  );
  const det = row?.detalleNivelacion || null;
  const viva = det?.fecha && (row?.nivelacion === true || row?.aprobadoNivelacion === true);
  if (!viva) throw new ValidationError('No tienes una nivelación pendiente de confirmar');

  if (det.confirmadoEn) {
    return successResponse({ confirmadoEn: det.confirmadoEn, confirmadoPor: det.confirmadoPor ?? null, yaEstaba: true });
  }
  // El plazo se cuenta desde el HORARIO ASIGNADO. Se resuelve aquí y no se
  // acepta del cliente: quien confirma no debe poder decidir su propio plazo.
  const ev = await queryOne<{ dia: string }>(
    `SELECT MIN(c."dia") AS dia
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
      WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
        AND b."cancelo" IS NOT TRUE
        AND c."tipo" = 'NIVELACION'
        AND c."dia" > NOW()`,
    [student.academicaId]
  ).catch(() => null);
  if (!puedeConfirmarAlumno(det, new Date(), ev?.dia ?? null)) {
    throw new ValidationError(MENSAJE_CONFIRMACION_VENCIDA);
  }

  const confirmadoEn = new Date().toISOString();
  const nuevo = { ...det, confirmadoEn, confirmadoPor: 'ESTUDIANTE', confirmadoPorNombre: null };

  await query(
    `UPDATE "ACADEMICA" SET "detalleNivelacion" = $2::jsonb, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [student.academicaId, JSON.stringify(nuevo)]
  );

  // Si el alumno tiene un caso asignado a NIVELACIONES, confirmar cierra ese
  // encargo: la nivelación quedó agendada Y confirmada, que es justo lo que el
  // área esperaba. Best-effort — la confirmación del alumno ya se guardó y no
  // debe deshacerse porque falle el arrastre del caso.
  let casoActualizado: string | null = null;
  try {
    const caso = await queryOne<{ _id: string; estado: string }>(
      `SELECT "_id", "estado"::text AS estado FROM "CASOS_ATENCION"
        WHERE "academicaId" = $1 AND "area" = 'NIVELACIONES'
          AND "estado"::text NOT IN ('RESUELTO','NIVELACION_AGENDADA')
        ORDER BY "_createdDate" DESC LIMIT 1`,
      [student.academicaId]
    );
    if (caso) {
      await query(
        `UPDATE "CASOS_ATENCION"
            SET "estado" = 'NIVELACION_AGENDADA', "cerradoEn" = NOW(),
                "cerradoPor" = 'sistema', "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [caso._id]
      );
      await query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
         VALUES ($1,$2,$3,'NIVELACION_AGENDADA',NULL,'Sistema',$4)`,
        [ids.comment(), caso._id, caso.estado,
         'La nivelación quedó agendada y el alumno la confirmó.']
      );
      casoActualizado = caso._id;
    }
  } catch (e) {
    console.warn('[nivelacion/confirmar] no se pudo arrastrar el caso:', e);
  }

  return successResponse({ confirmadoEn, confirmadoPor: 'ESTUDIANTE', corte: corteConfirmacion(det.fecha), casoActualizado });
});
