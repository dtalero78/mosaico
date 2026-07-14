import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { ForbiddenError } from '@/lib/errors'
import { query } from '@/lib/postgres'
import { generarEventosCurso, generarBookingsBeneficiario } from '@/services/cursos-campaign-eventos.service'

/**
 * POST /api/admin/regenerar-eventos-festivos   (SUPER_ADMIN)
 * Body: { apply?: boolean }  — sin apply = dry-run (solo reporta).
 *
 * Regenera los eventos de TODOS los cursos de campaña activos aplicando el salto
 * de festivos de Chile (los cursos generados antes del fix quedaron con eventos en
 * días festivos). Reusa generarEventosCurso (holiday-aware) + generarBookingsBeneficiario.
 *
 * Preserva el estado: por cada curso con alumnos, snapshotea los bookings con
 * asistencia/evaluación marcada (por estudiante + fecha), borra+regenera eventos y
 * bookings, y RE-APLICA ese estado al nuevo booking del mismo estudiante en la misma
 * fecha (las fechas pasadas no son festivos → el evento persiste). Los cupos
 * (usuInscritos) no se tocan.
 */
const STATE_COLS = ['asistio', 'asistencia', 'participacion', 'noAprobo', 'cancelo', 'calificacion', 'comentarios'] as const

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  if ((session.user as any)?.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Solo SUPER_ADMIN puede regenerar eventos.')
  }
  const body = await req.json().catch(() => ({}))
  const apply = body?.apply === true

  // OJO: inicioCurso/finalCurso son DATE → cast a ::text ('YYYY-MM-DD') porque
  // generarEventosCurso hace String(x).slice(0,10) (un objeto Date daría basura).
  const cursos = (await query(
    `SELECT "_id","campaign","tipoCurso","salon","guia","horarioCurso",
            "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso", "numeroUsuarios"
     FROM "CURSOS_CAMPAIGN" WHERE "activa" = true`
  )).rows

  const resumen: any[] = []
  let totalEventos = 0, totalBookings = 0, totalReapplied = 0, totalUnmatched = 0

  for (const curso of cursos) {
    // Alumnos inscritos = beneficiarios APROBADOS cuyo curso real (PEOPLE) coincide.
    // (Se deriva de PEOPLE, no de los bookings, para ser robusto ante regeneración.)
    const est = (await query(
      `SELECT DISTINCT a."_id" AS acaid, a."numeroId", a."primerNombre", a."primerApellido", a."celular", a."plataforma"
       FROM "PEOPLE" p
       JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
       WHERE p."tipoUsuario" = 'BENEFICIARIO'
         AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3
         AND p."aprobacion" IN ('Aprobado','Aprobada')
         AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
      [curso.campaign, curso.tipoCurso, curso.horarioCurso]
    )).rows

    // Snapshot de bookings con estado marcado (por estudiante + fecha)
    const snap = (await query(
      `SELECT b."idEstudiante" AS acaid, (b."fechaEvento")::date AS fecha,
              b."asistio", b."asistencia", b."participacion", b."noAprobo", b."cancelo", b."calificacion", b."comentarios"
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
       WHERE c."cursoCampaignId" = $1
         AND (b."asistio" = true OR b."asistencia" = true OR b."participacion" = true
              OR b."noAprobo" = true OR b."cancelo" = true OR b."calificacion" IS NOT NULL)`, [curso._id]
    )).rows

    const item: any = {
      curso: `${curso.campaign} · ${curso.tipoCurso} · Salón ${curso.salon}`,
      alumnos: est.length, estadoPreservado: snap.length,
    }

    if (!apply) {
      resumen.push({ ...item, dryRun: true })
      continue
    }

    try {
    // 1) Borrar bookings del curso
    await query(
      `DELETE FROM "ACADEMICA_BOOKINGS" b USING "CALENDARIO" c
       WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento") AND c."cursoCampaignId" = $1`, [curso._id])

    // 2) Regenerar eventos (holiday-aware) + mapeo de lecciones
    const nEv = await generarEventosCurso(curso as any)
    totalEventos += nEv
    item.eventos = nEv

    // 3) Regenerar bookings por alumno
    let nBk = 0
    for (const s of est) {
      nBk += await generarBookingsBeneficiario(s.acaid, {
        campaign: curso.campaign, tipoCurso: curso.tipoCurso, horarioCurso: curso.horarioCurso,
        numeroId: s.numeroId, primerNombre: s.primerNombre, primerApellido: s.primerApellido,
        celular: s.celular, plataforma: s.plataforma,
      })
    }
    totalBookings += nBk
    item.bookings = nBk

    // 4) Re-aplicar el estado preservado (por estudiante + fecha)
    let reapplied = 0, unmatched = 0
    for (const sp of snap) {
      const set = STATE_COLS.map((c, i) => `"${c}" = $${i + 3}`).join(', ')
      const vals = STATE_COLS.map((c) => (sp as any)[c])
      const r = await query(
        `UPDATE "ACADEMICA_BOOKINGS" b SET ${set}, "_updatedDate" = NOW()
         FROM "CALENDARIO" c
         WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento") AND c."cursoCampaignId" = $1
           AND b."idEstudiante" = $2 AND (b."fechaEvento")::date = $${STATE_COLS.length + 3}`,
        [curso._id, sp.acaid, ...vals, sp.fecha])
      if ((r.rowCount ?? 0) > 0) reapplied++; else unmatched++
    }
    totalReapplied += reapplied; totalUnmatched += unmatched
    item.estadoReaplicado = reapplied
    if (unmatched > 0) item.estadoSinMatch = unmatched // fecha cayó en festivo → no hay evento

    resumen.push(item)
    } catch (err: any) {
      item.error = err?.message || String(err)
      resumen.push(item)
    }
  }

  return successResponse({
    apply, cursosProcesados: resumen.length,
    totales: { eventos: totalEventos, bookings: totalBookings, estadoReaplicado: totalReapplied, estadoSinMatch: totalUnmatched },
    cursos: resumen,
  })
})
