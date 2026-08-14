import 'server-only'
import { query, queryOne } from '@/lib/postgres'
import { NotFoundError } from '@/lib/errors'
import { formatPhoneNumber } from '@/lib/whatsapp'
import { resolverApoderado } from '@/lib/apoderado'

/**
 * Actividad IA de la sesión — a quién se le manda.
 *
 * Vive en la capa de servicios (no en el route) porque la usan DOS endpoints:
 * el que lista los destinatarios para el modal y el que envía por WhatsApp. Así
 * la regla de "a qué teléfono se escribe" tiene una sola definición.
 */
/**
 * `formatPhoneNumber` LANZA con números inválidos (p. ej. un celular chileno
 * guardado sin el 56: "998252007"). Aquí un teléfono malo sólo debe dejar a ese
 * alumno como "sin teléfono" — nunca tumbar la lista entera del evento.
 */
const telefonoValido = (raw?: string | null): string => {
  try { return formatPhoneNumber(String(raw || '')) } catch { return '' }
}

/** Inscritos del evento con su apoderado resuelto. Una sola consulta. */
export async function destinatariosDelEvento(eventoId: string) {
  const evento = await queryOne<any>(
    `SELECT "_id","nivel","step","sesionModulo","sesionLeccion","nombreEvento","tituloONivel","dia","curso"
       FROM "CALENDARIO" WHERE "_id" = $1`,
    [eventoId]
  )
  if (!evento) throw new NotFoundError('Evento', eventoId)

  const rows = (await query<any>(
    `SELECT bk."_id" AS "bookingId",
            a."_id"  AS "academicaId",
            p."_id"  AS "peopleId",
            p."numeroId", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."celular", p."email", p."tipoCurso",
            p."apoderado", p."apoderadoTelefono", p."apoderadoMail",
            t."numeroId" AS "titNumeroId", t."primerNombre" AS "titPrimerNombre", t."segundoNombre" AS "titSegundoNombre",
            t."primerApellido" AS "titPrimerApellido", t."segundoApellido" AS "titSegundoApellido",
            t."celular" AS "titCelular", t."email" AS "titEmail"
       FROM "ACADEMICA_BOOKINGS" bk
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(bk."idEstudiante", bk."studentId")
       JOIN LATERAL (
         SELECT pp.* FROM "PEOPLE" pp
          WHERE pp."_id" = a."peopleId"
             OR (a."peopleId" IS NULL AND UPPER(TRIM(pp."numeroId")) = UPPER(TRIM(a."numeroId")))
          ORDER BY CASE WHEN pp."_id" = a."peopleId" THEN 0 ELSE 1 END,
                   CASE WHEN pp."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
          LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT tt.* FROM "PEOPLE" tt
          WHERE tt."contrato" = p."contrato" AND tt."tipoUsuario" = 'TITULAR' LIMIT 1
       ) t ON true
      WHERE COALESCE(bk."eventoId", bk."idEvento") = $1
        AND COALESCE(bk."cancelo", false) IS NOT TRUE
      ORDER BY p."primerApellido", p."primerNombre"`,
    [eventoId]
  )).rows

  const destinatarios = rows.map(r => {
    const apo = resolverApoderado(r, {
      numeroId: r.titNumeroId, primerNombre: r.titPrimerNombre, segundoNombre: r.titSegundoNombre,
      primerApellido: r.titPrimerApellido, segundoApellido: r.titSegundoApellido,
      celular: r.titCelular, email: r.titEmail,
    })
    const telefono = telefonoValido(apo.telefono)
    return {
      academicaId: r.academicaId,
      numeroId: r.numeroId,
      alumno: [r.primerNombre, r.primerApellido].filter(Boolean).join(' ').trim() || '(sin nombre)',
      tipoCurso: r.tipoCurso || '',
      apoderado: apo.nombre,
      telefono,
      // De dónde salió el teléfono: su ficha, el titular (que es él mismo) o el alumno.
      origen: telefono ? apo.origen : 'ninguno',
      enviable: !!telefono,
    }
  })

  return { evento, destinatarios }
}
