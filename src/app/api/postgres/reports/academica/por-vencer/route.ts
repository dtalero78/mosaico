import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { InformesPermission } from '@/types/permissions'
import { esAprobadoSql } from '@/lib/estados';

/**
 * GET /api/postgres/reports/academica/por-vencer
 *   ?tipo=titular|beneficiario (default: titular)
 *   &startDate=YYYY-MM-DD (default: hoy)
 *   &endDate=YYYY-MM-DD  (default: hoy + 1 mes)
 *   &search=...
 *   &hold=todos|con|sin       (solo aplica si tipo=beneficiario)
 *   &extension=todos|con|sin  (solo aplica si tipo=beneficiario)
 *
 * Lista contratos cuyo `finalContrato` vence dentro del rango. Dos modos:
 *
 *   tipo=titular     → TITULARES (1 fila por contrato). Columnas: nombre,
 *                      contrato, contacto, # beneficiarios, vencimiento,
 *                      días restantes. Botón "Ver" → /person/[id].
 *
 *   tipo=beneficiario → BENEFICIARIOS. Columnas: nombre, contrato, contacto,
 *                      Hold (onHoldCount), Extensión (extensionCount),
 *                      vencimiento, días restantes. Botón "Ver" →
 *                      /student/[academicaId] (fallback /person/[_id]).
 *
 * Filtros comunes: "aprobado y activo" =
 *   aprobacion aprobada (ver lib/estados)
 *   AND estadoInactivo IS NOT TRUE
 *   AND (estado IS NULL OR estado <> 'FINALIZADA')
 *   AND finalContrato BETWEEN $1 AND $2
 *   AND contrato NOT LIKE 'PRB-%'   (excluye contratos de prueba)
 *
 * Cabecera: total + (si beneficiario) Con Hold / Con Extensión sobre el set
 * filtrado, para que el admin vea de un vistazo cuántos necesitan atención.
 *
 * Gateado por INFORMES.ACADEMICA.POR_VENCER (SUPER_ADMIN/ADMIN bypass).
 */

const MAX_ROWS = 2000

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, InformesPermission.ACAD_POR_VENCER)

  const { searchParams } = new URL(req.url)
  const tipo      = (searchParams.get('tipo') || 'titular').toLowerCase()
  const search    = (searchParams.get('search') || '').trim()
  const startDate = searchParams.get('startDate') || null
  const endDate   = searchParams.get('endDate')   || null
  const hold      = (searchParams.get('hold') || 'todos').toLowerCase()
  const extension = (searchParams.get('extension') || 'todos').toLowerCase()

  if (!['titular', 'beneficiario'].includes(tipo)) {
    return successResponse({ rows: [], total: 0, conHold: 0, conExtension: 0, error: 'tipo inválido' })
  }
  const tipoUsuarioSql = tipo === 'titular' ? 'TITULAR' : 'BENEFICIARIO'

  // WHERE común
  const conds: string[] = [
    `p."tipoUsuario" = $${1}`,
    esAprobadoSql('p."aprobacion"'),
    `p."estadoInactivo" IS NOT TRUE`,
    `(p."estado" IS NULL OR p."estado" <> 'FINALIZADA')`,
    `p."finalContrato" IS NOT NULL`,
    `($2::date IS NULL OR p."finalContrato" >= $2::date)`,
    `($3::date IS NULL OR p."finalContrato" <= $3::date)`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
  ]
  const params: any[] = [tipoUsuarioSql, startDate, endDate]
  let i = 4

  if (search) {
    conds.push(`(
      p."primerNombre"   ILIKE $${i}
      OR p."primerApellido" ILIKE $${i}
      OR p."segundoApellido" ILIKE $${i}
      OR p."numeroId"    ILIKE $${i}
      OR p."contrato"    ILIKE $${i}
      OR p."email"       ILIKE $${i}
    )`)
    params.push(`%${search}%`); i++
  }

  // Filtros Hold / Extensión solo si beneficiario
  if (tipo === 'beneficiario') {
    if (hold === 'con') conds.push(`COALESCE(p."onHoldCount", 0) > 0`)
    else if (hold === 'sin') conds.push(`COALESCE(p."onHoldCount", 0) = 0`)

    if (extension === 'con') conds.push(`COALESCE(p."extensionCount", 0) > 0`)
    else if (extension === 'sin') conds.push(`COALESCE(p."extensionCount", 0) = 0`)
  }

  // Lateral para resolver el academicaId del beneficiario (para botón Ver → /student).
  // INNER JOIN LATERAL: excluye beneficiarios SIN registro académico — solo
  // aparecen los que efectivamente están cursando (los "Sin Registro" quedan
  // fuera de este informe, según decisión de mayo 2026).
  const lateralAcad = tipo === 'beneficiario'
    ? `JOIN LATERAL (
         SELECT a."_id" AS "academicaId"
         FROM "ACADEMICA" a
         WHERE a."numeroId" = p."numeroId"
         ORDER BY a."_createdDate" DESC NULLS LAST
         LIMIT 1
       ) acad ON true`
    : ''

  // Lateral para contar beneficiarios del titular (modo titular).
  const lateralBenef = tipo === 'titular'
    ? `LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS "n"
         FROM "PEOPLE" pb
         WHERE pb."contrato" = p."contrato"
           AND pb."tipoUsuario" <> 'TITULAR'
       ) bf ON true`
    : ''

  // SELECT: campos comunes + diferenciados según tipo
  const selectCamposComunes = `
    p."_id"               AS "_id",
    p."primerNombre",
    p."primerApellido",
    p."numeroId",
    p."contrato",
    p."plataforma",
    p."email",
    p."celular",
    p."finalContrato"::date AS "finalContrato",
    (p."finalContrato"::date - CURRENT_DATE)::int AS "diasRestantes"
  `
  const selectCamposPorTipo = tipo === 'titular'
    ? `, COALESCE(bf."n", 0) AS "beneficiarios"`
    : `, COALESCE(p."onHoldCount", 0)      AS "onHoldCount"
       , COALESCE(p."extensionCount", 0)   AS "extensionCount"
       , acad."academicaId"                AS "academicaId"`

  const rowsRes = await query<any>(`
    SELECT ${selectCamposComunes}
           ${selectCamposPorTipo}
    FROM "PEOPLE" p
    ${lateralAcad}
    ${lateralBenef}
    WHERE ${conds.join(' AND ')}
    ORDER BY p."finalContrato" ASC, p."primerApellido" ASC NULLS LAST
    LIMIT ${MAX_ROWS}
  `, params)

  const rows = rowsRes.rows.map((r: any) => ({
    _id: r._id,
    nombre: `${r.primerNombre ?? ''} ${r.primerApellido ?? ''}`.trim(),
    numeroId: r.numeroId,
    contrato: r.contrato,
    plataforma: r.plataforma,
    email: r.email,
    celular: r.celular,
    finalContrato: r.finalContrato,
    diasRestantes: Number(r.diasRestantes) ?? null,
    ...(tipo === 'titular'
      ? { beneficiarios: Number(r.beneficiarios) || 0 }
      : {
          onHoldCount: Number(r.onHoldCount) || 0,
          extensionCount: Number(r.extensionCount) || 0,
          academicaId: r.academicaId || null,
        }),
  }))

  // Totales para cabecera
  const total = rows.length
  const conHold = tipo === 'beneficiario'
    ? rows.filter((r: any) => (r.onHoldCount || 0) > 0).length
    : 0
  const conExtension = tipo === 'beneficiario'
    ? rows.filter((r: any) => (r.extensionCount || 0) > 0).length
    : 0

  return successResponse({
    tipo,
    rango: { startDate, endDate },
    rows,
    total,
    capped: total >= MAX_ROWS,
    maxRows: MAX_ROWS,
    conHold,
    conExtension,
  })
})
