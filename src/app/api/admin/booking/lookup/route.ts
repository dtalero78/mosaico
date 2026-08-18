import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { MantenimientoPermission } from '@/types/permissions'
import { query, queryOne } from '@/lib/postgres'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { normalizeNumeroId } from '@/lib/numeroid-normalize'
import { esAprobado } from '@/lib/estados'

/**
 * GET /api/admin/booking/lookup?numeroId=...
 *
 * Vista previa de "Booking" (Mantenimiento › Usuarios): resuelve al beneficiario
 * por su documento y devuelve su curso, salón, horario y guía, más el estado de
 * sus agendamientos — cuántos eventos tiene el curso, cuántos ya tiene y cuántos
 * le faltan, separando FUTUROS (se crean) de PASADOS (no).
 *
 * No escribe nada. Gateado por MANTENIMIENTO.USUARIOS.BOOKING.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.BOOKING)

  const { searchParams } = new URL(request.url)
  const raw = (searchParams.get('numeroId') || '').trim()
  if (!raw) throw new ValidationError('Indica el número de documento del usuario')
  const norm = normalizeNumeroId(raw)

  // El documento puede estar guardado con puntos/guiones: se compara normalizado.
  // Se prefiere el BENEFICIARIO (un titular puede compartir numeroId con su hijo).
  const persona = await queryOne<any>(
    `SELECT p."_id", p."numeroId", p."primerNombre", p."segundoNombre",
            p."primerApellido", p."segundoApellido", p."contrato", p."aprobacion",
            p."estadoInactivo", p."cupoConfirmado", p."cupoLiberado", p."fechaOnHold"::text AS "fechaOnHold",
            p."campaign", p."tipoCurso", p."salon", p."horarioCurso", p."tipoUsuario",
            a."_id" AS "academicaId", a."curso" AS "cursoAcademica",
            a."nivel", a."step", a."estadoInactivo" AS "academicaInactivo"
       FROM "PEOPLE" p
       LEFT JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
      WHERE UPPER(REGEXP_REPLACE(COALESCE(p."numeroId",''), '[.\\s\\-_]', '', 'g')) = $1
      ORDER BY CASE WHEN p."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END,
               p."_createdDate" DESC
      LIMIT 1`,
    [norm]
  )
  if (!persona) throw new NotFoundError('Usuario con documento', raw)

  const problemas: string[] = []
  // Avisos: no impiden generar, pero el admin debe saberlos antes de hacerlo.
  const advertencias: string[] = []
  if (persona.tipoUsuario !== 'BENEFICIARIO') {
    problemas.push('Este documento corresponde a un TITULAR, no a un usuario del curso. Los agendamientos son de los beneficiarios.')
  }
  if (!persona.academicaId) {
    problemas.push('No tiene registro académico (ACADEMICA); sin él no se le pueden colgar agendamientos.')
  }
  if (!persona.campaign || !persona.tipoCurso || !persona.horarioCurso) {
    problemas.push('No tiene curso asignado (campaña / curso / horario), así que no hay calendario del que colgar sus clases.')
  }

  if (!esAprobado(persona.aprobacion)) {
    advertencias.push('El contrato aún no está aprobado. Al aprobarlo, sus clases se generan solas — normalmente no hace falta hacerlo a mano aquí.')
  }
  if (persona.estadoInactivo) {
    advertencias.push('El usuario está inactivo: tendrá las clases agendadas, pero no podrá entrar a la plataforma hasta que se active.')
  }
  if (persona.fechaOnHold) {
    advertencias.push(`Está en OnHold desde el ${String(persona.fechaOnHold).slice(0, 10)}.`)
  }
  if (persona.cupoLiberado) {
    advertencias.push('Tiene el cupo LIBERADO: ya no ocupa asiento en el salón. Revisa si corresponde agendarle clases.')
  }

  // Curso y su calendario
  let curso: any = null
  let eventos = { total: 0, futuros: 0, pasados: 0 }
  if (persona.campaign && persona.tipoCurso && persona.horarioCurso) {
    curso = await queryOne<any>(
      `SELECT cc."_id", cc."salon", cc."horarioCurso", cc."numeroUsuarios",
              cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso",
              g."nombreCompleto" AS "guia"
         FROM "CURSOS_CAMPAIGN" cc
         LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
        WHERE cc."campaign"=$1 AND cc."tipoCurso"=$2 AND cc."horarioCurso"=$3
        LIMIT 1`,
      [persona.campaign, persona.tipoCurso, persona.horarioCurso]
    )
    if (!curso) {
      problemas.push(`El curso ${persona.tipoCurso} · ${persona.horarioCurso} no existe en la campaña ${persona.campaign}.`)
    } else {
      const e = await queryOne<any>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE "dia" >= NOW())::int AS futuros,
                COUNT(*) FILTER (WHERE "dia" <  NOW())::int AS pasados
           FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`,
        [curso._id]
      )
      eventos = { total: e?.total ?? 0, futuros: e?.futuros ?? 0, pasados: e?.pasados ?? 0 }
      if (eventos.total === 0) {
        problemas.push('El curso todavía no tiene sesiones creadas en el calendario.')
      }
    }
  }

  // Agendamientos que ya tiene, y los que faltan
  let bookings = { total: 0, futuros: 0, pasados: 0 }
  let faltan = { futuros: 0, pasados: 0 }
  let proxima: string | null = null
  if (persona.academicaId && curso) {
    const b = await queryOne<any>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e."dia" >= NOW())::int AS futuros,
              COUNT(*) FILTER (WHERE e."dia" <  NOW())::int AS pasados
         FROM "ACADEMICA_BOOKINGS" k
         JOIN "CALENDARIO" e ON e."_id" = k."eventoId" OR e."_id" = k."idEvento"
        WHERE (k."idEstudiante" = $1 OR k."studentId" = $1)
          AND e."cursoCampaignId" = $2`,
      [persona.academicaId, curso._id]
    )
    bookings = { total: b?.total ?? 0, futuros: b?.futuros ?? 0, pasados: b?.pasados ?? 0 }
    faltan = {
      futuros: Math.max(0, eventos.futuros - bookings.futuros),
      pasados: Math.max(0, eventos.pasados - bookings.pasados),
    }
    const px = await queryOne<{ dia: string }>(
      `SELECT MIN(e."dia")::text AS dia
         FROM "ACADEMICA_BOOKINGS" k
         JOIN "CALENDARIO" e ON e."_id" = k."eventoId" OR e."_id" = k."idEvento"
        WHERE (k."idEstudiante" = $1 OR k."studentId" = $1) AND e."dia" >= NOW()`,
      [persona.academicaId]
    )
    proxima = px?.dia || null
  }

  const nombre = [persona.primerNombre, persona.segundoNombre, persona.primerApellido, persona.segundoApellido]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

  return successResponse({
    persona: { ...persona, nombre },
    curso,
    eventos,
    bookings,
    faltan,
    proxima,
    problemas,
    advertencias,
    puedeGenerar: problemas.length === 0 && faltan.futuros > 0,
  })
})
