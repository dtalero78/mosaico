import 'server-only'
import { randomUUID } from 'crypto'
import { query } from '@/lib/postgres'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'
import { usaApoderadoAsync } from '@/services/tipos-curso.service'
import { MessageTemplatesRepository } from '@/repositories/message-templates.repository'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { fillTemplate } from '@/lib/message-template-filler'
import { TZ_OPERACION } from '@/lib/cursos-campaign'
import {
  SLUG_RECORDATORIO_TALLER, MAX_RECORDATORIOS, MIN_TALLER_EN_CURSO,
  fechaHoraTaller, tallerTerminado,
} from '@/lib/taller'

/**
 * Servicio › Talleres: los talleres (eventos tipo CLUB) con sus inscritos.
 *
 *   proximos   los que aún no terminan (siguen aquí mientras se dictan), con el
 *              recordatorio por WhatsApp
 *   historico  los ya realizados, con la asistencia de cada inscrito
 *
 * La unidad es el AGENDAMIENTO vivo (no cancelado). El curso, la campaña y el
 * salón que se filtran y por los que se agrupa son los del ALUMNO, no los del
 * evento: un taller se crea con curso o salón "Todos" y junta alumnos de varios.
 *
 * A quién va el recordatorio: la MISMA regla de Envío de Mensajes › Por evento
 * (`envio-evento.service`) — al apoderado si el curso del alumno lo usa (catálogo
 * Tipos de Curso) y su teléfono tiene 10+ dígitos; si no, al alumno.
 */

export type ModoTalleres = 'proximos' | 'historico'

export interface FiltrosTalleres {
  modo: ModoTalleres
  usuario?: string
  campaign?: string
  curso?: string
  salon?: string
  desde?: string
  hasta?: string
}

const digitos = (s?: string | null) => String(s || '').replace(/\D/g, '')
const NO_PRB = `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/

/** El FROM común: talleres → agendamientos vivos → alumno → ficha PEOPLE. */
const FROM = `
  FROM "CALENDARIO" c
  JOIN "ACADEMICA_BOOKINGS" bk
    ON (bk."eventoId" = c."_id" OR bk."idEvento" = c."_id")
   AND COALESCE(bk."cancelo", false) = false
  JOIN "ACADEMICA" a ON a."_id" = COALESCE(bk."idEstudiante", bk."studentId")
  JOIN LATERAL (
    SELECT pp.* FROM "PEOPLE" pp
     WHERE pp."_id" = a."peopleId"
        OR (a."peopleId" IS NULL AND UPPER(TRIM(pp."numeroId")) = UPPER(TRIM(a."numeroId")))
     ORDER BY CASE WHEN pp."_id" = a."peopleId" THEN 0 ELSE 1 END,
              CASE WHEN pp."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
     LIMIT 1
  ) p ON true`

/** WHERE del modo y las fechas (lo que define el universo de la pestaña). */
function whereBase(f: FiltrosTalleres, params: any[]): string[] {
  const w = [`UPPER(c."tipo") = 'CLUB'`, NO_PRB]
  w.push(f.modo === 'historico'
    ? `c."dia" + INTERVAL '${MIN_TALLER_EN_CURSO} minutes' <= NOW()`
    : `c."dia" + INTERVAL '${MIN_TALLER_EN_CURSO} minutes' > NOW()`)
  if (f.desde && FECHA_OK.test(f.desde)) {
    params.push(f.desde); w.push(`(c."dia" AT TIME ZONE '${TZ_OPERACION}')::date >= $${params.length}::date`)
  }
  if (f.hasta && FECHA_OK.test(f.hasta)) {
    params.push(f.hasta); w.push(`(c."dia" AT TIME ZONE '${TZ_OPERACION}')::date <= $${params.length}::date`)
  }
  return w
}

const SELECT_FILAS = `
  SELECT bk."_id" AS "bookingId", bk."origen",
         c."_id" AS "eventoId", c."dia", c."nombreEvento", c."tituloONivel",
         c."curso" AS "eventoCurso", c."salon" AS "eventoSalon", c."limiteUsuarios",
         g."nombreCompleto" AS guia,
         a."_id" AS "academicaId",
         COALESCE(p."numeroId", a."numeroId") AS "numeroId",
         p."primerNombre", p."primerApellido",
         ${exprNombreCompleto('p')} AS nombre,
         p."contrato", p."campaign", p."tipoCurso", p."salon", p."celular",
         p."apoderado", p."apoderadoTelefono",
         (COALESCE(bk."asistio", false) OR COALESCE(bk."asistencia", false)) AS asistio,
         rec."_createdDate" AS "recordatorioEn", rec."telefono" AS "recordatorioTelefono",
         rec."enviadoPorNombre" AS "recordatorioPor"
  ${FROM}
  LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
  LEFT JOIN LATERAL (
    SELECT r."_createdDate", r."telefono", r."enviadoPorNombre"
      FROM "TALLER_RECORDATORIOS" r
     WHERE r."bookingId" = bk."_id" AND r."ok" = true
     ORDER BY r."_createdDate" DESC LIMIT 1
  ) rec ON true`

/** Destino del mensaje y si es el apoderado (regla de `envio-evento.service`). */
async function conDestino<T extends { tipoCurso?: string | null; apoderadoTelefono?: string | null; celular?: string | null }>(rows: T[]) {
  const usaApo = new Map<string, boolean>()
  for (const c of Array.from(new Set(rows.map(r => String(r.tipoCurso || ''))))) {
    usaApo.set(c, c ? await usaApoderadoAsync(c) : false)
  }
  return rows.map(r => {
    const apo = digitos(r.apoderadoTelefono)
    const alApoderado = !!usaApo.get(String(r.tipoCurso || '')) && apo.length >= 10
    const telefono = alApoderado ? apo : digitos(r.celular)
    return { ...r, telefono: telefono || null, esApoderado: alApoderado, telefonoValido: telefono.length >= 10 }
  })
}

/** Un mismo alumno agendado dos veces en el mismo taller cuenta (y recibe) una vez. */
function sinDuplicados<T extends { eventoId: string; academicaId: string }>(rows: T[]): T[] {
  const vistos = new Set<string>()
  return rows.filter(r => {
    const k = `${r.eventoId}|${r.academicaId}`
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

export async function listarTalleres(f: FiltrosTalleres) {
  const params: any[] = []
  const w = whereBase(f, params)
  // Catálogos de los filtros: el universo de la pestaña SIN los filtros del
  // alumno, para que elegir una campaña no esconda las demás.
  const opts = (await query<any>(
    `SELECT DISTINCT p."campaign", p."tipoCurso", p."salon" ${FROM} WHERE ${w.join(' AND ')}`,
    [...params]
  )).rows

  if (f.campaign) { params.push(f.campaign); w.push(`p."campaign" = $${params.length}`) }
  if (f.curso) { params.push(f.curso); w.push(`p."tipoCurso" = $${params.length}`) }
  if (f.salon) { params.push(f.salon); w.push(`p."salon" = $${params.length}`) }
  if (f.usuario?.trim()) {
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'COALESCE(p."numeroId", a."numeroId")', f.usuario.trim(), params.length + 1, 'p."contrato"')
    params.push(...c.params); w.push(c.sql)
  }

  const orden = f.modo === 'historico' ? 'c."dia" DESC' : 'c."dia" ASC'
  const filas = (await query<any>(
    `${SELECT_FILAS}
      WHERE ${w.join(' AND ')}
      ORDER BY ${orden}, p."tipoCurso" NULLS LAST, p."primerApellido", p."primerNombre"
      LIMIT 5000`,
    params
  )).rows

  const rows = (await conDestino(sinDuplicados(filas))).map(r => {
    const { fecha, hora } = fechaHoraTaller(r.dia)
    return { ...r, fechaTaller: fecha, horaTaller: hora }
  })

  const tpl = await MessageTemplatesRepository.findBySlug(SLUG_RECORDATORIO_TALLER).catch(() => null)
  const uniq = (k: string) => Array.from(new Set(opts.map((o: any) => o[k]).filter(Boolean))).sort() as string[]

  return {
    rows,
    total: rows.length,
    campaigns: uniq('campaign').reverse(),
    cursos: uniq('tipoCurso'),
    salones: uniq('salon'),
    plantilla: tpl ? { nombre: tpl.nombre, contenido: tpl.contenido, activo: tpl.activo } : null,
  }
}

/**
 * Envía el recordatorio a los agendamientos elegidos. El navegador sólo manda
 * QUÉ agendamientos: el teléfono y el texto se resuelven aquí, igual que en
 * Envío de Mensajes. Cada envío (bueno o fallido) queda en TALLER_RECORDATORIOS.
 */
export async function enviarRecordatorios(bookingIds: string[], actor: { email: string; nombre: string }) {
  const ids = Array.from(new Set(bookingIds.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())))
  if (!ids.length) throw new ValidationError('Selecciona al menos un inscrito')
  if (ids.length > MAX_RECORDATORIOS) throw new ValidationError(`Máximo ${MAX_RECORDATORIOS} destinatarios por envío`)

  const tpl = await MessageTemplatesRepository.findBySlug(SLUG_RECORDATORIO_TALLER)
  if (!tpl) throw new NotFoundError('Plantilla', SLUG_RECORDATORIO_TALLER)
  if (!tpl.activo) throw new ValidationError(`La plantilla "${tpl.nombre}" está inactiva. Actívala en Gestión de Plantillas.`)

  const filas = (await query<any>(
    `${SELECT_FILAS}
      WHERE bk."_id" = ANY($1::text[]) AND UPPER(c."tipo") = 'CLUB'`,
    [ids]
  )).rows
  if (!filas.length) throw new ValidationError('Los inscritos seleccionados ya no están en ningún taller')
  const terminados = filas.filter(r => tallerTerminado(r.dia))
  if (terminados.length) {
    throw new ValidationError(`El taller de ${terminados[0].nombre || 'un inscrito'} ya terminó: el recordatorio es para talleres próximos.`)
  }

  const destinos = await conDestino(sinDuplicados(filas))
  const resultados: { bookingId: string; nombre: string; telefono: string | null; ok: boolean; error?: string }[] = []

  for (const r of destinos) {
    const { fecha, hora } = fechaHoraTaller(r.dia)
    const mensaje = fillTemplate(tpl.contenido, {
      nombre: r.primerNombre, primerApellido: r.primerApellido,
      numeroId: r.numeroId, contrato: r.contrato,
      apoderado: r.apoderado || null,
      curso: r.tipoCurso, fechaTaller: fecha, horaTaller: hora,
    })
    let ok = false
    let error: string | undefined
    if (!r.telefonoValido) {
      error = 'Sin teléfono válido'
    } else {
      try { await sendWhatsAppMessage(r.telefono!, mensaje); ok = true }
      catch (e: any) { error = e?.message || 'Error al enviar' }
    }
    await query(
      `INSERT INTO "TALLER_RECORDATORIOS"
         ("_id","bookingId","eventoId","academicaId","numeroId","telefono","esApoderado","ok","error","enviadoPor","enviadoPorNombre")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [randomUUID(), r.bookingId, r.eventoId, r.academicaId, r.numeroId, r.telefono, r.esApoderado,
       ok, error || null, actor.email, actor.nombre]
    ).catch(e => console.warn('[talleres] no se pudo registrar el recordatorio:', e?.message))
    resultados.push({ bookingId: r.bookingId, nombre: r.nombre, telefono: r.telefono, ok, error })
  }

  const enviados = resultados.filter(r => r.ok).length
  return { enviados, fallidos: resultados.length - enviados, resultados }
}
