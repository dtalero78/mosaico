import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { InformesPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/academica/x-niveles?nivel&startDate&endDate
 *
 * Listado de usuarios en ACADEMICA por nivel. Columnas: nombre, id (numeroId),
 * correo, nivel, step. Conteo total + desglose por nivel.
 *
 * Filtros:
 *   - nivel: código exacto (BN1, BN2, …, DONE) o vacío/'todos' = todos.
 *   - startDate/endDate (opcionales): rango por fecha de contrato
 *     (COALESCE fechaContrato, _createdDate). Vacíos = sin filtro de fecha.
 *
 * Gateado por INFORMES.ACADEMICA.X_NIVELES (SUPER_ADMIN/ADMIN bypass).
 */

const CDATE = `COALESCE("fechaContrato", ("_createdDate" AT TIME ZONE 'America/Bogota')::date)`
const MAX_ROWS = 8000

// Orden pedagógico para el dropdown/chips de nivel (los no listados —ESS,
// WELCOME, DONE— van al final). Steps se ordenan numéricamente (0→50).
const NIVEL_ORDER = ['BN1', 'BN2', 'BN3', 'P1', 'P2', 'P3', 'F1', 'F2', 'F3', 'MASTER', 'IELTS', 'B2FIRST', 'TOEFL', 'WELCOME', 'ESS', 'DONE']
const nivelRank = (n: string) => { const i = NIVEL_ORDER.indexOf(n); return i >= 0 ? i : 999 }

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, InformesPermission.ACAD_X_NIVELES)

  const { searchParams } = new URL(req.url)
  const nivelRaw  = (searchParams.get('nivel') || '').trim()
  const nivel     = nivelRaw && nivelRaw.toLowerCase() !== 'todos' ? nivelRaw : null
  const stepRaw   = (searchParams.get('step') || '').trim()
  const step      = stepRaw && stepRaw.toLowerCase() !== 'todos' ? stepRaw : null
  const startDate = searchParams.get('startDate') || null
  const endDate   = searchParams.get('endDate') || null

  // $1 nivel, $2 startDate, $3 endDate, $4 step (todos opcionales)
  const where = `
    "nivel" IS NOT NULL AND TRIM("nivel") <> ''
    AND ($1::text IS NULL OR "nivel" = $1)
    AND ($2::date IS NULL OR ${CDATE} >= $2::date)
    AND ($3::date IS NULL OR ${CDATE} <= $3::date)
    AND ($4::text IS NULL OR "step" = $4)`
  const params = [nivel, startDate, endDate, step]

  const rowsRes = await query<any>(`
    SELECT
      TRIM(CONCAT(COALESCE("primerNombre",''), ' ', COALESCE("primerApellido",''))) AS nombre,
      "numeroId" AS id,
      "email" AS correo,
      "nivel",
      "step"
    FROM "ACADEMICA"
    WHERE ${where}
    ORDER BY "nivel" ASC,
      NULLIF(REGEXP_REPLACE(COALESCE("step",''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
      nombre ASC
    LIMIT ${MAX_ROWS}`, params)

  const totalRes = await query<{ n: number }>(`SELECT COUNT(*)::int n FROM "ACADEMICA" WHERE ${where}`, params)
  const total = Number(totalRes.rows[0]?.n) || 0

  // Desglose por nivel (respeta el filtro de fecha; ignora el de nivel para mostrar el panorama)
  const porNivelRes = await query<{ nivel: string; n: number }>(`
    SELECT "nivel", COUNT(*)::int n FROM "ACADEMICA"
    WHERE "nivel" IS NOT NULL AND TRIM("nivel") <> ''
      AND ($1::date IS NULL OR ${CDATE} >= $1::date)
      AND ($2::date IS NULL OR ${CDATE} <= $2::date)
    GROUP BY "nivel" ORDER BY n DESC`, [startDate, endDate])

  // Niveles disponibles para el dropdown (orden pedagógico, no alfabético)
  const nivelesRes = await query<{ nivel: string }>(`
    SELECT DISTINCT "nivel" FROM "ACADEMICA" WHERE "nivel" IS NOT NULL AND TRIM("nivel") <> ''`)
  const niveles = nivelesRes.rows.map(r => r.nivel).sort((a, b) => nivelRank(a) - nivelRank(b) || a.localeCompare(b))

  // Steps disponibles para el nivel seleccionado (ordenados numéricamente).
  // Vacío cuando no hay nivel ('Todos') — el filtro de step aplica por nivel.
  const stepsDisponibles = nivel
    ? (await query<{ step: string }>(`
        SELECT "step" FROM "ACADEMICA"
        WHERE "nivel" = $1 AND "step" IS NOT NULL AND TRIM("step") <> ''
        GROUP BY "step"
        ORDER BY NULLIF(REGEXP_REPLACE("step", '[^0-9]', '', 'g'), '')::int NULLS LAST, "step"`, [nivel])).rows.map(r => r.step)
    : []

  return successResponse({
    rows: rowsRes.rows,
    total,
    capped: total > MAX_ROWS,
    maxRows: MAX_ROWS,
    porNivel: porNivelRes.rows
      .map(r => ({ nivel: r.nivel, n: Number(r.n) }))
      .sort((a, b) => nivelRank(a.nivel) - nivelRank(b.nivel) || a.nivel.localeCompare(b.nivel)),
    meta: { niveles, stepsDisponibles, nivel: nivel ?? '', step: step ?? '', startDate: startDate ?? '', endDate: endDate ?? '' },
  })
})
