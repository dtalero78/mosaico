import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query, queryOne } from '@/lib/postgres'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import { generateId } from '@/lib/id-generator'
import { formatPhoneNumber, sendWhatsAppMessage } from '@/lib/whatsapp'
import { usaApoderadoAsync } from '@/services/tipos-curso.service'

/**
 * POST /api/postgres/reports/servicio/casos-atencion/asistencia/recordatorio
 * Body: { bookingId }
 *
 * Envía por WhatsApp el aviso de inasistencia de UNA sesión.
 *
 * Destinatario (misma regla que el resto de la plataforma,
 * `cursoUsaApoderadoParaMensajes`): en los cursos de menores (YOJI/OKINA/KODOMO/
 * DANSHI) va al teléfono del APODERADO; en SENPAI/IMPULSA, al del alumno. Si el
 * destinatario que corresponde no tiene teléfono, se cae al otro antes de fallar.
 *
 * Los datos se releen de la BD a partir del bookingId — el cliente sólo manda el
 * identificador, nunca el teléfono ni el texto.
 * Gateado por SERVICIO.CASOS_ATENCION.GESTION.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_GESTION)

  const b = await request.json().catch(() => ({}))
  const bookingId = String(b?.bookingId || '').trim()
  if (!bookingId) throw new ValidationError('Falta el registro de inasistencia.')

  const row = await queryOne<any>(
    `SELECT bk."_id" AS "bookingId",
            a."_id" AS "academicaId",
            p."numeroId",
            p."primerNombre", p."tipoCurso",
            p."apoderado", p."apoderadoTelefono", p."celular",
            COALESCE(c."step", bk."step") AS leccion,
            COALESCE(c."dia", bk."fechaEvento") AS fecha
       FROM "ACADEMICA_BOOKINGS" bk
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(bk."idEstudiante", bk."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(bk."eventoId", bk."idEvento")
      WHERE bk."_id" = $1`,
    [bookingId]
  )
  if (!row) throw new NotFoundError('Inasistencia', bookingId)

  const usaApoderado = await usaApoderadoAsync(row.tipoCurso || '')
  const preferido = usaApoderado ? row.apoderadoTelefono : row.celular
  const alterno = usaApoderado ? row.celular : row.apoderadoTelefono
  const telefono = formatPhoneNumber(preferido || '') || formatPhoneNumber(alterno || '')
  if (!telefono) {
    throw new ValidationError(
      usaApoderado
        ? 'El apoderado de este estudiante no tiene teléfono registrado.'
        : 'Este estudiante no tiene teléfono registrado.'
    )
  }

  const nombre = String(row.primerNombre || '').trim() || 'el estudiante'
  const fecha = row.fecha
    ? new Date(row.fecha).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' })
    : ''
  const leccion = String(row.leccion || '').trim()

  const mensaje = usaApoderado
    ? `Estimado apoderado, le informamos que ${nombre} no asistió a su sesión${leccion ? ` de ${leccion}` : ''}${fecha ? ` del ${fecha}` : ''}. Le recordamos la importancia de la asistencia para su avance en el programa. Quedamos atentos. — MOSAICO`
    : `Hola ${nombre}, notamos que no asististe a tu sesión${leccion ? ` de ${leccion}` : ''}${fecha ? ` del ${fecha}` : ''}. Te recordamos la importancia de la asistencia para tu avance en el programa. Quedamos atentos. — MOSAICO`

  await sendWhatsAppMessage(telefono, mensaje)

  const email = (session as any)?.user?.email || 'desconocido'
  await query(
    `INSERT INTO "INASISTENCIA_GESTION"
       ("_id","bookingId","academicaId","numeroId","recordatorioEnviado","recordatorioPor","recordatorioEn","recordatorioTelefono")
     VALUES ($1,$2,$3,$4,true,$5,NOW(),$6)
     ON CONFLICT ("bookingId") DO UPDATE SET
       "recordatorioEnviado"  = true,
       "recordatorioPor"      = EXCLUDED."recordatorioPor",
       "recordatorioEn"       = NOW(),
       "recordatorioTelefono" = EXCLUDED."recordatorioTelefono",
       "_updatedDate"         = NOW()`,
    [generateId('ing'), bookingId, row.academicaId, row.numeroId, email, telefono]
  )

  return successResponse({ ok: true, to: telefono, destinatario: usaApoderado ? 'apoderado' : 'estudiante' })
})
