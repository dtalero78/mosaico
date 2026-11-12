import 'server-only'
import { query, queryMany, queryOne } from '@/lib/postgres'
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors'
import { normalizeNumeroId } from '@/lib/numeroid-normalize'
import { isContractExpired } from '@/lib/contract-expiry'
import { eventEndDate } from '@/lib/event-duration'
import { enlaceClaseSql } from '@/lib/zoom-link'
import { generateId } from '@/lib/id-generator'
import { sendWhatsAppMessage } from '@/lib/whatsapp'

/**
 * Link de sesión por contingencia (Mantenimiento › Usuarios › Link de sesión).
 *
 * Dado el ID de un estudiante, encuentra su PRÓXIMA SESIÓN DE HOY (hora de Chile):
 * la primera clase de hoy que todavía no termina — si ya terminaron todas, no
 * salta a mañana, porque lo que se manda por contingencia es el link de ahora.
 * Y envía ese link por WhatsApp al apoderado.
 *
 * El navegador sólo manda el ID del estudiante y el teléfono; la sesión, el link
 * y los nombres se vuelven a leer aquí, nunca se toman del cliente.
 */

export interface SesionHoy {
  eventoId: string
  fechaEvento: string
  fin: string
  tipo: string
  leccion: string
  guia: string
  link: string
}

export interface ResultadoLink {
  estudiante: {
    academicaId: string
    numeroId: string
    nombre: string
    campana: string
    curso: string
    salon: string
    horario: string
    contrato: string
  }
  apoderado: { nombre: string; telefono: string }
  sesion: SesionHoy | null
  motivoSinSesion: string | null
  avisos: string[]
  yaEnviado: { fecha: string; por: string } | null
}

const TZ = 'America/Santiago'

const nombreDe = (...partes: Array<string | null | undefined>) =>
  partes.map(p => String(p || '').trim()).filter(Boolean).join(' ')

export async function buscarSesionHoy(numeroIdCrudo: string): Promise<ResultadoLink> {
  const numeroId = normalizeNumeroId(numeroIdCrudo).replace(/[^A-Z0-9]/g, '')
  if (!numeroId) throw new ValidationError('Ingrese el ID del estudiante.')

  const filas = await queryMany<any>(
    `SELECT a."_id" AS "academicaId", a."numeroId", a."estadoInactivo" AS "acadInactivo",
            p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."tipoCurso", p."campaign", p."salon", p."horarioCurso", p."contrato",
            p."apoderado", p."apoderadoTelefono", p."estadoInactivo" AS "peopleInactivo",
            p."fechaOnHold", p."finalContrato"
       FROM "ACADEMICA" a
       LEFT JOIN LATERAL (
         SELECT * FROM "PEOPLE" p2
          WHERE p2."numeroId" = a."numeroId"
          ORDER BY CASE WHEN p2."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
          LIMIT 1
       ) p ON TRUE
      WHERE REGEXP_REPLACE(UPPER(a."numeroId"), '[^A-Z0-9]', '', 'g') = $1`,
    [numeroId]
  )
  if (!filas.length) throw new NotFoundError('Estudiante', numeroIdCrudo)
  const est = filas[0]

  if (/^PRB-/i.test(String(est.contrato || ''))) {
    throw new ValidationError('Es un contrato de prueba: no se puede enviar su link de sesión.')
  }

  const avisos: string[] = []
  if (est.peopleInactivo === true || est.acadInactivo === true) {
    avisos.push(est.fechaOnHold
      ? 'El estudiante está en pausa (OnHold).'
      : 'El estudiante está INACTIVO.')
  }
  if (est.finalContrato && isContractExpired(est.finalContrato)) {
    avisos.push('El contrato del estudiante está vencido.')
  }

  // Sesiones de HOY (día de Chile) de cualquiera de sus fichas académicas.
  const ids = filas.map((f: any) => f.academicaId)
  const sesiones = await queryMany<any>(
    `SELECT c."_id" AS "eventoId", c."dia", c."tipo", c."nombreEvento", c."duracionMin",
            COALESCE(c."sesionLeccion", c."step", ab."step") AS "leccion",
            ge."nombreCompleto" AS "guia",
            ${enlaceClaseSql('ge', 'c."linkZoom"')} AS "link"
       FROM "ACADEMICA_BOOKINGS" ab
       JOIN "CALENDARIO" c ON (c."_id" = ab."eventoId" OR c."_id" = ab."idEvento")
       LEFT JOIN "GUIAS" ge ON ge."_id" = c."advisor"
      WHERE (ab."idEstudiante" = ANY($1::text[]) OR ab."studentId" = ANY($1::text[]))
        AND ab."cancelo" IS NOT TRUE
        AND (c."dia" AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date
      ORDER BY c."dia" ASC`,
    [ids]
  )

  const ahora = Date.now()
  let sesion: SesionHoy | null = null
  let motivoSinSesion: string | null = null
  for (const s of sesiones) {
    const fin = eventEndDate(s.dia, s.tipo, s.nombreEvento, s.duracionMin)
    if (fin.getTime() > ahora) {
      sesion = {
        eventoId: s.eventoId,
        fechaEvento: new Date(s.dia).toISOString(),
        fin: fin.toISOString(),
        tipo: String(s.tipo || ''),
        leccion: String(s.leccion || '').trim(),
        guia: String(s.guia || '').trim(),
        link: String(s.link || '').trim(),
      }
      break
    }
  }
  if (!sesion) {
    motivoSinSesion = sesiones.length
      ? 'Ya terminaron todas las sesiones de hoy de este estudiante.'
      : 'Este estudiante no tiene sesiones agendadas hoy.'
  }

  let yaEnviado: ResultadoLink['yaEnviado'] = null
  if (sesion) {
    const prev = await queryOne<any>(
      `SELECT "_createdDate", COALESCE("enviadoPorNombre", "enviadoPor") AS por
         FROM "LINK_CONTINGENCIA_ENVIOS"
        WHERE "academicaId" = ANY($1::text[]) AND "eventoId" = $2 AND "ok" = true
        ORDER BY "_createdDate" DESC LIMIT 1`,
      [ids, sesion.eventoId]
    )
    if (prev) yaEnviado = { fecha: new Date(prev._createdDate).toISOString(), por: String(prev.por || '') }
  }

  return {
    estudiante: {
      academicaId: est.academicaId,
      numeroId: est.numeroId,
      nombre: nombreDe(est.primerNombre, est.segundoNombre, est.primerApellido, est.segundoApellido),
      campana: String(est.campaign || ''),
      curso: String(est.tipoCurso || ''),
      salon: String(est.salon || ''),
      horario: String(est.horarioCurso || ''),
      contrato: String(est.contrato || ''),
    },
    apoderado: {
      nombre: String(est.apoderado || '').trim(),
      telefono: String(est.apoderadoTelefono || '').replace(/\D/g, ''),
    },
    sesion,
    motivoSinSesion,
    avisos,
    yaEnviado,
  }
}

export function armarMensaje(p: { apoderado: string; estudiante: string; curso: string; link: string }): string {
  const saludo = p.apoderado ? `Estimado apoderado *${p.apoderado}*` : 'Estimado apoderado'
  return (
    `${saludo}, a continuación le enviamos el link de acceso a la sesión de *${p.estudiante}*, ` +
    `que se le envía por contingencia.\n\n` +
    `${p.link}\n\n` +
    `Si tiene dudas sobre el procedimiento regular de ingreso a la plataforma y acceso a las sesiones ` +
    `del curso *${p.curso}*, solicite soporte a este número.`
  )
}

export async function enviarLink(
  input: { numeroId: string; telefono: string; confirmarReenvio?: boolean },
  actor: { email: string; nombre: string }
): Promise<{ telefono: string }> {
  const telefono = String(input.telefono || '').replace(/\D/g, '')
  if (telefono.length < 10 || telefono.length > 15) {
    throw new ValidationError('El teléfono no es válido: debe tener entre 10 y 15 dígitos, con el indicativo del país.')
  }

  const r = await buscarSesionHoy(input.numeroId)
  if (!r.sesion) throw new ValidationError(r.motivoSinSesion || 'No hay una sesión para enviar.')
  if (!r.sesion.link) {
    throw new ValidationError('La sala del guía de esta sesión no tiene link de Zoom cargado: no hay nada que enviar.')
  }
  if (r.yaEnviado && !input.confirmarReenvio) {
    throw new ConflictError('El link de esta sesión ya se envió. Confirme el reenvío para mandarlo de nuevo.')
  }

  const primerNombre = r.estudiante.nombre.split(' ')[0] || r.estudiante.nombre
  const mensaje = armarMensaje({
    apoderado: r.apoderado.nombre,
    estudiante: primerNombre,
    curso: r.estudiante.curso,
    link: r.sesion.link,
  })

  let error: string | null = null
  try {
    await sendWhatsAppMessage(telefono, mensaje)
  } catch (e: any) {
    error = String(e?.message || 'Error al enviar el WhatsApp').slice(0, 300)
  }

  await query(
    `INSERT INTO "LINK_CONTINGENCIA_ENVIOS"
       ("_id","academicaId","numeroId","eventoId","fechaEvento","telefono","ok","error","enviadoPor","enviadoPorNombre")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [generateId('lnk'), r.estudiante.academicaId, r.estudiante.numeroId, r.sesion.eventoId,
     r.sesion.fechaEvento, telefono, error === null, error, actor.email, actor.nombre]
  )

  if (error) throw new ValidationError(`No se pudo enviar el WhatsApp: ${error}`)
  return { telefono }
}
