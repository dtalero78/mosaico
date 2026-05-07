import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { query, queryOne, queryMany } from '@/lib/postgres'
import { ForbiddenError, ValidationError } from '@/lib/errors'

async function ensureClearHistoricColumns() {
  try {
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "chkclrhistoric" INTEGER`, [])
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "clrhistoric" JSONB`, [])
  } catch { /* ignore */ }
}

/** Run a count query — returns 0 on any error (missing table, missing column, etc.) */
async function safeCount(sql: string, params: any[]): Promise<number> {
  try {
    const row = await queryOne<{ count: string }>(sql, params)
    return parseInt(row?.count ?? '0', 10)
  } catch (err: any) {
    console.warn('[clear-historic/lookup] safeCount:', err.message)
    return 0
  }
}

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  const role = (session.user as any)?.role
  if (role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Solo SUPER_ADMIN puede ejecutar operaciones de limpieza')
  }

  const { searchParams } = new URL(req.url)
  const numeroId = searchParams.get('numeroId')?.trim()

  if (!numeroId) {
    throw new ValidationError('numeroId es requerido')
  }

  // ── PEOPLE ──────────────────────────────────────────────────────────
  let peopleRows: { _id: string; primerNombre: string; primerApellido: string; tipoUsuario: string }[] = []
  try {
    peopleRows = await queryMany(
      `SELECT "_id", "primerNombre", "primerApellido", "tipoUsuario"
       FROM "PEOPLE"
       WHERE "numeroId" = $1`,
      [numeroId]
    )
  } catch (err: any) {
    console.error('[clear-historic/lookup] PEOPLE query error:', err.message)
    throw new ValidationError(`Error consultando PEOPLE: ${err.message}`)
  }

  // ── ACADEMICA ────────────────────────────────────────────────────────
  await ensureClearHistoricColumns()
  let academicaRows: { _id: string; nivel: string; step: string; chkclrhistoric?: number; clrhistoric?: any }[] = []
  try {
    academicaRows = await queryMany(
      `SELECT "_id", "nivel", "step", "chkclrhistoric", "clrhistoric"
       FROM "ACADEMICA"
       WHERE "numeroId" = $1`,
      [numeroId]
    )
  } catch (err: any) {
    console.error('[clear-historic/lookup] ACADEMICA query error:', err.message)
    throw new ValidationError(`Error consultando ACADEMICA: ${err.message}`)
  }

  const inPeople = peopleRows.length > 0
  const inAcademica = academicaRows.length > 0

  if (!inPeople || !inAcademica) {
    return successResponse({
      found: false,
      inPeople,
      inAcademica,
      message: !inPeople && !inAcademica
        ? 'No se encontró en PEOPLE ni en ACADEMICA'
        : !inPeople
        ? 'No se encontró en PEOPLE'
        : 'No se encontró en ACADEMICA',
    })
  }

  // Prefer BENEFICIARIO row for display name
  const personRow =
    peopleRows.find(r => r.tipoUsuario === 'BENEFICIARIO' || r.tipoUsuario === 'BENEFICIARIA') ??
    peopleRows[0]

  const nombreCompleto = [personRow.primerNombre, personRow.primerApellido]
    .filter(Boolean)
    .join(' ')

  const academicaIds = academicaRows.map(r => r._id)

  // Check if clear historic already done (any academica record has chkclrhistoric >= 1)
  const alreadyDone = academicaRows.some(r => r.chkclrhistoric && r.chkclrhistoric >= 1)
  const previousAudit = alreadyDone
    ? (academicaRows.find(r => r.clrhistoric)?.clrhistoric ?? null)
    : null

  // ── Counts (safe — 0 on error) ───────────────────────────────────────
  const bookingsCount = await safeCount(
    `SELECT COUNT(*)::text AS count
     FROM "ACADEMICA_BOOKINGS" ab
     WHERE COALESCE(ab."studentId", ab."idEstudiante") = ANY($1::text[])
       AND ab."nivel" IS DISTINCT FROM 'WELCOME'
       AND (ab."step" IS NULL OR ab."step" NOT ILIKE '%WELCOME%')
       AND COALESCE(ab."tipoEvento", ab."tipo") IS DISTINCT FROM 'WELCOME'
       AND (ab."tituloONivel" IS NULL OR ab."tituloONivel" NOT ILIKE '%WELCOME%')
       AND (ab."nombreEvento" IS NULL OR ab."nombreEvento" NOT ILIKE '%WELCOME%')`,
    [academicaIds]
  )

  const complementariaCount = await safeCount(
    `SELECT COUNT(*)::text AS count
     FROM "COMPLEMENTARIA_ATTEMPTS"
     WHERE "studentId" = ANY($1::text[])`,
    [academicaIds]
  )

  const stepOverridesCount = await safeCount(
    `SELECT COUNT(*)::text AS count
     FROM "STEP_OVERRIDES"
     WHERE "studentId" = ANY($1::text[])`,
    [academicaIds]
  )

  return successResponse({
    found: true,
    inPeople: true,
    inAcademica: true,
    nombreCompleto,
    numeroId,
    academicaIds,
    alreadyDone,
    previousAudit,
    counts: {
      bookings: bookingsCount,
      complementaria: complementariaCount,
      stepOverrides: stepOverridesCount,
    },
  })
})
