import 'server-only'
import { query, queryOne } from '@/lib/postgres'
import { cupoOcupadoSql } from '@/lib/cupo'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'
import { TIPOS_FUERA_DE_CASOS_SQL } from '@/lib/tipos-sesion'
import { rangoUltimoMes, MAX_MOTIVO_JUSTIFICACION } from '@/lib/justificacion'
import { generateId } from '@/lib/id-generator'
import { ValidationError, NotFoundError, ForbiddenError } from '@/lib/errors'
import { alcancePorGuia } from '@/services/guia-sesion.service'
import { alcanceSinResultados } from '@/lib/alcance-guia'
import { autoAvanceModuloPorBooking } from '@/services/modulo-avance.service'

/**
 * Gestión Justificación — inasistencias a las sesiones del curso y su
 * justificación.
 *
 * Una inasistencia es un agendamiento de una sesión YA OCURRIDA, no cancelado y
 * sin asistencia marcada: el mismo criterio que la pestaña Asistencia de Casos de
 * Atención (mismos tipos excluidos, mismos alumnos que ocupan cupo), para que las
 * dos pantallas hablen del mismo conjunto.
 *
 * Justificar escribe en el AGENDAMIENTO (`escusa` + `justificaescusa`), que es lo
 * que ya leen la ficha del alumno, el panel de la sesión y el avance de IMPULSA;
 * en INASISTENCIA_GESTION sólo queda quién y cuándo. La falta SIGUE contando como
 * ausencia.
 *
 * Alcance: el rol GUIA ve sólo los ausentes de los cursos que él dicta
 * (`CURSOS_CAMPAIGN.guia`), resuelto en el SERVIDOR con su correo; los demás
 * roles eligen el guía.
 */

const MAX_ROWS = 5000

const ES_SESION = `UPPER(COALESCE(c."tipo", b."tipo", b."tipoEvento", 'SESSION')) NOT IN (${TIPOS_FUERA_DE_CASOS_SQL})`
const FECHA = `COALESCE(c."dia", b."fechaEvento")`
const LECCION = `COALESCE(c."sesionLeccion", c."step", b."step")`

/** Lo que define una inasistencia (sin filtros de pantalla). */
const BASE_WHERE = [
  `COALESCE(b."asistio", false) = false`,
  `COALESCE(b."asistencia", false) = false`,
  `COALESCE(b."cancelo", false) = false`,
  `${FECHA} < NOW()`,
  ES_SESION,
  `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
  cupoOcupadoSql('p'),
]

const FROM = `
  FROM "ACADEMICA_BOOKINGS" b
  JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
  JOIN "PEOPLE" p ON p."_id" = a."peopleId"
  LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
  LEFT JOIN "CURSOS_CAMPAIGN" cc
    ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
  LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"`

export interface FiltrosJustificacion {
  usuario?: string
  campaign?: string
  curso?: string
  salon?: string
  guiaId?: string
  startDate?: string
  endDate?: string
  estado?: 'pendientes' | 'justificadas' | ''
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function listarInasistencias(session: any, f: FiltrosJustificacion) {
  const alcance = await alcancePorGuia(session, f.guiaId)
  const vacio = {
    rows: [], total: 0, pendientes: 0, justificadas: 0, truncado: false,
    campanias: [], cursos: [], salones: [], guias: [],
    soloPropios: alcance.soloPropios, guiaId: alcance.guiaId,
  }
  if (alcanceSinResultados(alcance)) return vacio

  const def = rangoUltimoMes()
  // Nunca después de HOY (Chile): una sesión futura no es una inasistencia. La
  // consulta ya exige que la sesión haya ocurrido; esto evita además que la
  // pantalla muestre un rango que promete algo que no puede traer.
  const tope = (d: string) => (d > def.hasta ? def.hasta : d)
  const desde = tope(f.startDate && ISO.test(f.startDate) ? f.startDate : def.desde)
  const hasta = tope(f.endDate && ISO.test(f.endDate) ? f.endDate : def.hasta)

  const where = [...BASE_WHERE]
  const params: any[] = []
  let i = 1
  where.push(`${FECHA} >= ($${i++}::date::timestamp AT TIME ZONE 'America/Santiago')`); params.push(desde)
  where.push(`${FECHA} < (($${i++}::date + 1)::timestamp AT TIME ZONE 'America/Santiago')`); params.push(hasta)
  if (alcance.guiaId) { where.push(`cc."guia" = $${i++}`); params.push(alcance.guiaId) }

  // Las opciones de los desplegables salen del universo SIN los filtros de
  // pantalla (sí con fechas y guía): si salieran de lo filtrado, al elegir una
  // campaña desaparecerían las demás.
  const whereBase = [...where]
  const paramsBase = [...params]

  if (f.campaign) { where.push(`p."campaign" = $${i++}`); params.push(f.campaign) }
  if (f.curso)    { where.push(`p."tipoCurso" = $${i++}`); params.push(f.curso) }
  if (f.salon)    { where.push(`p."salon" = $${i++}`); params.push(f.salon) }
  if (f.usuario) {
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'p."numeroId"', f.usuario, i, 'p."contrato"')
    where.push(c.sql); params.push(...c.params); i += 2
  }

  // Contadores de las dos pestañas con los MISMOS filtros que la lista (menos el
  // estado), así el número nunca contradice a la tabla.
  const conteo = await queryOne<{ pendientes: string; justificadas: string }>(
    `SELECT COUNT(*) FILTER (WHERE COALESCE(b."escusa", false) = false) AS pendientes,
            COUNT(*) FILTER (WHERE b."escusa" IS TRUE) AS justificadas
       ${FROM}
      WHERE ${where.join(' AND ')}`,
    params
  )

  if (f.estado === 'pendientes') where.push(`COALESCE(b."escusa", false) = false`)
  if (f.estado === 'justificadas') where.push(`b."escusa" IS TRUE`)

  const rows = (await query(
    `SELECT b."_id" AS "bookingId",
            a."_id" AS "academicaId",
            p."_id" AS "peopleId",
            ${exprNombreCompleto('p')} AS nombre,
            p."numeroId", p."contrato", p."campaign", p."tipoCurso" AS curso, p."salon",
            p."horarioCurso" AS horario,
            c."sesionModulo" AS modulo, ${LECCION} AS leccion,
            ${FECHA} AS fecha,
            cc."guia" AS "guiaId", g."nombreCompleto" AS guia,
            p."apoderado", p."apoderadoTelefono",
            COALESCE(b."escusa", false) AS justificada,
            b."justificaescusa" AS motivo,
            ig."justificadoPorNombre", ig."justificadoPor", ig."justificadoEn"
       ${FROM}
       LEFT JOIN "INASISTENCIA_GESTION" ig ON ig."bookingId" = b."_id"
      WHERE ${where.join(' AND ')}
      ORDER BY fecha DESC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS + 1}`,
    params
  )).rows

  const opts = (await query(
    `SELECT DISTINCT p."campaign" AS campaign, p."tipoCurso" AS curso, p."salon" AS salon
       ${FROM}
      WHERE ${whereBase.join(' AND ')}`,
    paramsBase
  )).rows

  // Para el selector de guía (roles no GUIA): todos los guías activos, igual que
  // el "Ver panel de" del Panel Guía.
  const guias = alcance.soloPropios ? [] : (await query(
    `SELECT "_id" AS id, "nombreCompleto" AS nombre FROM "GUIAS"
      WHERE COALESCE("activo", true) = true AND NULLIF(TRIM("nombreCompleto"), '') IS NOT NULL
      ORDER BY "nombreCompleto"`
  )).rows

  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean))).sort() as string[]
  const truncado = rows.length > MAX_ROWS
  return {
    rows: truncado ? rows.slice(0, MAX_ROWS) : rows,
    total: Math.min(rows.length, MAX_ROWS),
    truncado,
    pendientes: Number(conteo?.pendientes) || 0,
    justificadas: Number(conteo?.justificadas) || 0,
    campanias: uniq(opts.map((o: any) => o.campaign)),
    cursos: uniq(opts.map((o: any) => o.curso)),
    salones: uniq(opts.map((o: any) => o.salon)),
    guias,
    desde, hasta,
    soloPropios: alcance.soloPropios,
    guiaId: alcance.guiaId,
  }
}

/**
 * Justifica (o quita la justificación de) UNA inasistencia.
 * - Debe ser una inasistencia real (sesión ya ocurrida, sin asistencia, no
 *   cancelada): justificar una clase asistida o futura no tiene sentido.
 * - El rol GUIA sólo puede tocar las de los cursos que dicta.
 * - El motivo es obligatorio al justificar.
 */
export async function justificarInasistencia(
  session: any,
  input: { bookingId: string; justificar: boolean; motivo?: string },
) {
  const bookingId = String(input.bookingId || '').trim()
  if (!bookingId) throw new ValidationError('Falta la inasistencia a justificar.')
  const justificar = !!input.justificar
  const motivo = String(input.motivo || '').trim()
  if (justificar && !motivo) throw new ValidationError('Escribe el motivo de la justificación.')
  if (motivo.length > MAX_MOTIVO_JUSTIFICACION) {
    throw new ValidationError(`El motivo no puede superar ${MAX_MOTIVO_JUSTIFICACION} caracteres.`)
  }

  const bk = await queryOne<any>(
    `SELECT b."_id", a."_id" AS "academicaId", p."numeroId", cc."guia" AS "guiaId",
            COALESCE(b."asistio", false) OR COALESCE(b."asistencia", false) AS asistio,
            COALESCE(b."cancelo", false) AS cancelo,
            ${FECHA} < NOW() AS ocurrio
       ${FROM}
      WHERE b."_id" = $1`,
    [bookingId]
  )
  if (!bk) throw new NotFoundError('Inasistencia', bookingId)

  const alcance = await alcancePorGuia(session)
  if (alcance.soloPropios && (!alcance.guiaId || alcance.guiaId !== bk.guiaId)) {
    throw new ForbiddenError('Sólo puedes justificar inasistencias de tus cursos.')
  }
  if (bk.asistio) throw new ValidationError('El alumno asistió a esa sesión: no hay inasistencia que justificar.')
  if (bk.cancelo) throw new ValidationError('Ese agendamiento está cancelado.')
  if (!bk.ocurrio) throw new ValidationError('La sesión todavía no ocurre.')

  const email = (session as any)?.user?.email || 'desconocido'
  const nombre = (session as any)?.user?.name || email

  await query(
    `UPDATE "ACADEMICA_BOOKINGS"
        SET "escusa" = $2, "justificaescusa" = $3, "_updatedDate" = NOW()
      WHERE "_id" = $1`,
    [bookingId, justificar, justificar ? motivo : '']
  )
  await query(
    `INSERT INTO "INASISTENCIA_GESTION"
       ("_id","bookingId","academicaId","numeroId","justificadoPor","justificadoPorNombre","justificadoEn")
     VALUES ($1,$2,$3,$4,
             CASE WHEN $5 THEN $6 ELSE NULL END,
             CASE WHEN $5 THEN $7 ELSE NULL END,
             CASE WHEN $5 THEN NOW() ELSE NULL END)
     ON CONFLICT ("bookingId") DO UPDATE SET
       "justificadoPor"       = EXCLUDED."justificadoPor",
       "justificadoPorNombre" = EXCLUDED."justificadoPorNombre",
       "justificadoEn"        = EXCLUDED."justificadoEn",
       "_updatedDate"         = NOW()`,
    [generateId('ing'), bookingId, bk.academicaId, bk.numeroId, justificar, email, nombre]
  )

  // En IMPULSA la falta justificada cumple la lección: se revisa el avance de
  // módulo igual que cuando se justifica desde la ficha del alumno. Best-effort.
  if (justificar) await autoAvanceModuloPorBooking(bookingId)

  return { ok: true, justificada: justificar }
}
