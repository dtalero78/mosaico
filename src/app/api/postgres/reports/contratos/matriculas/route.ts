import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query, queryOne } from '@/lib/postgres'
import { InformesPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/contratos/matriculas?startDate&endDate&pais
 *
 * Informe de Matrículas (estado de contratos). Tarjetas + barras + dona + heatmap.
 *
 * Filtros:
 *   - pais: ADVISORS/PEOPLE.plataforma (null = todos)
 *   - startDate/endDate: rango por FECHA DE CONTRATO (COALESCE inicioContrato,
 *     fechaContrato, _createdDate). Aplica al "embudo" de contratos (x Aprobar,
 *     vigentes, finalizados, beneficiarios, barras, dona). Las tarjetas
 *     académicas (Activos/OnHold/Inactivos) son ESTADO ACTUAL: sólo país.
 *
 * Definiciones (PEOPLE.tipoUsuario='TITULAR', descartando contratos de prueba
 * — nombre/apellido placeholder, vacío o que contenga 'PRUEBA'):
 *   - x Aprobar  = NO aprobados: aprobacion NULL o NOT IN (Aprobado,Aprobada,FINALIZADA)
 *                  (incluye Rechazado/Devuelto/Retractado/Contrato Nulo/Pendiente).
 *   - Vigentes   = aprobacion IN (Aprobado,Aprobada) Y estado <> FINALIZADA.
 *   - Finalizados= estado = FINALIZADA.
 *   - Beneficiarios = BENEFICIARIO(/A) cuyo titular es Vigente.
 *   - Académicos activos   = ACADEMICA Step 0–49 (o WELCOME) y estadoInactivo!=true.
 *   - Académicos OnHold    = PEOPLE beneficiarios en OnHold (fechaOnHold + estadoInactivo).
 *   - Académicos inactivos = ACADEMICA Step 50 (DONE).
 *
 * Gateado por INFORMES.CONTRATOS.MATRICULAS (SUPER_ADMIN/ADMIN bypass).
 */

// Filtro de contrato "real" (no placeholder / no vacío / no PRUEBA)
const NOMBRE_OK = `(
  UPPER(COALESCE("primerNombre",'')) NOT IN ('TITULAR','BENEFICIARIO','BENEFICIARIA')
  AND UPPER(COALESCE("primerApellido",'')) NOT IN ('TITULAR','BENEFICIARIO','BENEFICIARIA')
  AND TRIM(COALESCE("primerNombre",'')) <> ''
  AND UPPER(COALESCE("primerNombre",'')) NOT LIKE '%PRUEBA%'
  AND UPPER(COALESCE("primerApellido",'')) NOT LIKE '%PRUEBA%'
)`
const CDATE     = `COALESCE("inicioContrato","fechaContrato",("_createdDate" AT TIME ZONE 'America/Bogota')::date)`
const APROBADO  = `("aprobacion" IN ('Aprobado','Aprobada'))`
const NO_APROBADO = `("aprobacion" IS NULL OR "aprobacion" NOT IN ('Aprobado','Aprobada','FINALIZADA'))`
const STEP_NUM  = `NULLIF(REGEXP_REPLACE("step",'[^0-9]','','g'),'')`
// $1 = pais, $2 = startDate, $3 = endDate  (embudo de contratos por fecha)
const PAIS_FECHA = `($1::text IS NULL OR "plataforma" = $1) AND (${CDATE} BETWEEN $2::date AND $3::date)`

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, InformesPermission.CONTRATOS_MATRICULAS)

  const { searchParams } = new URL(req.url)
  const pais      = searchParams.get('pais') || null
  const startDate = searchParams.get('startDate') || `${new Date().getFullYear()}-01-01`
  const endDate   = searchParams.get('endDate')   || new Date().toISOString().substring(0, 10)
  const num = (r: any) => Number(r?.n) || 0

  const pf = [pais, startDate, endDate]      // embudo (país + fecha)
  const pp = [pais]                          // sólo país (estado actual)

  const [
    xAprobarR, vigentesR, finalizadosR, beneficiariosR,
    acadActivosR, onHoldR, acadInactivosR,
  ] = await Promise.all([
    queryOne<{ n: number }>(`SELECT COUNT(*)::int n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND ${NO_APROBADO} AND ${NOMBRE_OK} AND ${PAIS_FECHA}`, pf),
    queryOne<{ n: number }>(`SELECT COUNT(*)::int n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND ${APROBADO} AND ("estado" IS DISTINCT FROM 'FINALIZADA') AND ${NOMBRE_OK} AND ${PAIS_FECHA}`, pf),
    queryOne<{ n: number }>(`SELECT COUNT(*)::int n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND "estado"='FINALIZADA' AND ${NOMBRE_OK} AND ${PAIS_FECHA}`, pf),
    queryOne<{ n: number }>(`
      SELECT COUNT(*)::int n FROM "PEOPLE" b
      WHERE b."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
        AND ($1::text IS NULL OR b."plataforma" = $1)
        AND b."titularId" IN (
          SELECT t."_id" FROM "PEOPLE" t
          WHERE t."tipoUsuario"='TITULAR' AND (t."aprobacion" IN ('Aprobado','Aprobada'))
            AND (t."estado" IS DISTINCT FROM 'FINALIZADA')
            AND (COALESCE(t."inicioContrato",t."fechaContrato",(t."_createdDate" AT TIME ZONE 'America/Bogota')::date) BETWEEN $2::date AND $3::date)
            AND ( UPPER(COALESCE(t."primerNombre",'')) NOT IN ('TITULAR','BENEFICIARIO','BENEFICIARIA')
                  AND TRIM(COALESCE(t."primerNombre",'')) <> ''
                  AND UPPER(COALESCE(t."primerNombre",'')) NOT LIKE '%PRUEBA%'
                  AND UPPER(COALESCE(t."primerApellido",'')) NOT LIKE '%PRUEBA%' )
        )`, pf),
    queryOne<{ n: number }>(`
      SELECT COUNT(*)::int n FROM "ACADEMICA"
      WHERE ("estadoInactivo" IS NOT TRUE) AND ($1::text IS NULL OR "plataforma" = $1)
        AND ( ("step" ILIKE 'Step %' AND ${STEP_NUM} IS NOT NULL AND ${STEP_NUM}::int BETWEEN 0 AND 49) OR "step"='WELCOME' )`, pp),
    queryOne<{ n: number }>(`
      SELECT COUNT(*)::int n FROM "PEOPLE"
      WHERE "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
        AND "fechaOnHold" IS NOT NULL AND "estadoInactivo"=true
        AND ($1::text IS NULL OR "plataforma" = $1) AND ${NOMBRE_OK}`, pp),
    queryOne<{ n: number }>(`SELECT COUNT(*)::int n FROM "ACADEMICA" WHERE "step"='Step 50' AND ($1::text IS NULL OR "plataforma" = $1)`, pp),
  ])

  const cards = {
    xAprobar:            num(xAprobarR),
    vigentes:            num(vigentesR),
    finalizados:         num(finalizadosR),
    beneficiarios:       num(beneficiariosR),
    academicosActivos:   num(acadActivosR),
    academicosOnHold:    num(onHoldR),
    academicosInactivos: num(acadInactivosR),
  }

  // Barras: pendientes (no aprobados) por antigüedad sin aprobar
  const barRow = await queryOne<{ b1: number; b2: number; b3: number }>(`
    WITH p AS (
      SELECT GREATEST(0, (CURRENT_DATE - ${CDATE})) AS dias
      FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND ${NO_APROBADO} AND ${NOMBRE_OK} AND ${PAIS_FECHA}
    )
    SELECT COUNT(*) FILTER (WHERE dias>=7 AND dias<30)::int b1,
           COUNT(*) FILTER (WHERE dias>=30 AND dias<60)::int b2,
           COUNT(*) FILTER (WHERE dias>=60)::int b3
    FROM p`, pf)
  const barPendientes = [
    { name: '1 sem – 1 mes', value: Number(barRow?.b1) || 0 },
    { name: '1 – 2 meses',   value: Number(barRow?.b2) || 0 },
    { name: '+2 meses',      value: Number(barRow?.b3) || 0 },
  ]

  const donut = [
    { name: 'Aprobadas (sin finalizar)', value: cards.vigentes },
    { name: 'Sin aprobar',               value: cards.xAprobar },
  ].filter(d => d.value > 0)

  // Heatmap: matrículas aprobadas por país × mes (año del rango / endDate)
  const heatYear = Number((endDate || '').substring(0, 4)) || new Date().getFullYear()
  const heatRows = await query<{ pais: string; mes: number; n: number }>(`
    SELECT COALESCE(NULLIF(TRIM("plataforma"),''),'Sin país') AS pais,
           EXTRACT(MONTH FROM COALESCE("inicioContrato","fechaContrato"))::int AS mes,
           COUNT(*)::int AS n
    FROM "PEOPLE"
    WHERE "tipoUsuario"='TITULAR' AND ("aprobacion" IN ('Aprobado','Aprobada','FINALIZADA')) AND ${NOMBRE_OK}
      AND ($1::text IS NULL OR "plataforma" = $1)
      AND COALESCE("inicioContrato","fechaContrato") IS NOT NULL
      AND EXTRACT(YEAR FROM COALESCE("inicioContrato","fechaContrato")) = $2
    GROUP BY 1, 2`, [pais, heatYear])
  const paises = Array.from(new Set(heatRows.rows.map(r => r.pais))).sort()
  const heatmap = {
    year: heatYear,
    paises,
    data: heatRows.rows.map(r => ({ pais: r.pais, mes: Number(r.mes), n: Number(r.n) })),
  }

  // Lista de países para el dropdown
  const paisesAll = await query<{ pais: string }>(`
    SELECT DISTINCT "plataforma" AS pais FROM "PEOPLE"
    WHERE "tipoUsuario"='TITULAR' AND "plataforma" IS NOT NULL AND TRIM("plataforma") <> '' ORDER BY 1`)

  return successResponse({
    cards, barPendientes, donut, heatmap,
    meta: { paises: paisesAll.rows.map(r => r.pais), startDate, endDate, pais },
  })
})
