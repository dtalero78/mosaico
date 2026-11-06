import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'
import { ESTADO_ABIERTO } from '@/lib/casos-atencion-estados'

/**
 * GET /api/postgres/reports/servicio/casos-atencion?curso&salon&leccion&guia&startDate&endDate
 *
 * Casos de Atención ABIERTOS y SIN asignar a un área, venga el reporte de un
 * guía o del equipo (Servicio, asistentes...). Una fila por caso. Columnas:
 * curso, nombre, salón, lección (+ tema), guía, fecha, el caso y conteo de
 * casos abiertos del estudiante. Gateado por SERVICIO.CASOS_ATENCION.VER.
 */
const MAX_ROWS = 5000

/**
 * Origen de las filas. La pestaña se lee desde el CASO, no desde la marca del
 * agendamiento: regenerar un curso borra y recrea sus agendamientos (y con ellos
 * la marca `casoAtencion`) mientras el caso sigue abierto, y 73 de 132 casos
 * abiertos habían quedado fuera de la lista por eso. El agendamiento es un
 * dato opcional del caso (aporta lección y fecha cuando existe).
 *
 *  A) todo caso abierto y SIN asignar a un área, tenga o no agendamiento;
 *  B) agendamientos marcados de datos anteriores al módulo, sin caso enlazado.
 * Si el agendamiento no existe, `bookingId` vale `caso:<id>` para que "Asignar"
 * pueda actuar sobre el caso directamente.
 */
const SRC_SQL = `
  src AS (
    SELECT ca."_id" AS "casoId", ca."academicaId" AS "academicaId",
           ca."eventoOrigenId" AS "eventoId",
           COALESCE(bk."_id", 'caso:' || ca."_id") AS "bookingId",
           bk."step" AS "bStep", bk."fechaEvento" AS "bFecha",
           COALESCE(NULLIF(bk."advisorAnotaciones",''), rep."texto") AS "caso",
           ca."_createdDate" AS "creado"
      FROM "CASOS_ATENCION" ca
      LEFT JOIN LATERAL (
        SELECT x.* FROM "ACADEMICA_BOOKINGS" x
         WHERE COALESCE(x."idEstudiante", x."studentId") = ca."academicaId"
           AND COALESCE(x."eventoId", x."idEvento") = ca."eventoOrigenId"
         ORDER BY x."casoAtencion" DESC NULLS LAST, x."_createdDate" DESC LIMIT 1
      ) bk ON true
      LEFT JOIN LATERAL (
        SELECT r."texto" FROM "CASOS_REPORTES" r
         WHERE r."casoId" = ca."_id" ORDER BY r."_createdDate" ASC LIMIT 1
      ) rep ON true
     WHERE ca."estado"::text = '${ESTADO_ABIERTO}' AND ca."area" IS NULL
    UNION ALL
    SELECT NULL, COALESCE(b."idEstudiante", b."studentId"), COALESCE(b."eventoId", b."idEvento"),
           b."_id", b."step", b."fechaEvento", b."advisorAnotaciones", b."fechaEvento"
      FROM "ACADEMICA_BOOKINGS" b
     WHERE b."casoAtencion" = true
       AND NOT EXISTS (
         SELECT 1 FROM "CASOS_ATENCION" y
          WHERE y."academicaId" = COALESCE(b."idEstudiante", b."studentId")
            AND y."eventoOrigenId" = COALESCE(b."eventoId", b."idEvento"))
  )`

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_VER)

  const { searchParams } = new URL(request.url)
  const campaign = (searchParams.get('campaign') || '').trim()
  const curso = (searchParams.get('curso') || '').trim()
  const salon = (searchParams.get('salon') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const usuario = (searchParams.get('usuario') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const where: string[] = [
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    // Todos los casos, ocupe o no cupo el alumno: un caso reportado no puede
    // desaparecer de la bandeja porque el alumno se inactivó o soltó el salón.
  ]
  const params: any[] = []
  let i = 1
  if (campaign) { where.push(`p."campaign" = $${i++}`); params.push(campaign) }
  if (curso)   { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (salon)   { where.push(`p."salon" = $${i++}`); params.push(salon) }
  if (leccion) { where.push(`COALESCE(c."step", s."bStep") = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }
  if (startDate) { where.push(`COALESCE(c."dia", s."bFecha", s."creado") >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`COALESCE(c."dia", s."bFecha", s."creado") < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }
  if (usuario) {
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'p."numeroId"', usuario, i, 'p."contrato"')
    where.push(c.sql); params.push(...c.params); i += 2
  }

  const rows = (await query(
    `WITH ${SRC_SQL}
     SELECT s."bookingId" AS "bookingId",
            a."_id" AS "academicaId",
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."numeroId" AS "numeroId",
            p."contrato",
            -- Titular del contrato: el enlace del nº de contrato abre SU ficha en
            -- la pestaña Financiera (el resumen financiero es del titular, no del
            -- beneficiario). LATERAL para quedarnos con uno solo.
            tit."_id" AS "titularId",
            p."salon",
            COALESCE(c."step", s."bStep") AS leccion,
            n."description" AS tema,
            g."nombreCompleto" AS guia,
            s."caso" AS caso,
            COALESCE(ca."estado"::text, '${ESTADO_ABIERTO}') AS estado,
            ca."codigo" AS "codigoCaso",
            -- Tipo del CASO (Asistencia, Conducta, Pago...): va bajo el guia.
            ca."tema"::text AS "tipoCaso",
            -- Quién lo levantó: parte la pestaña en Docentes / Admin. Sin caso
            -- enlazado (datos viejos) es del guía, que era la única vía.
            COALESCE(ca."origen", 'DOCENTE') AS origen,
            -- Intentos de contacto con el apoderado: el caso sigue sin asignar,
            -- pero Servicio ya puede haberlo llamado. Uno por CANAL (el último de
            -- cada uno): con sólo el último en general, un WhatsApp "Pendiente"
            -- escondería la llamada "Sin respuesta" de un minuto antes.
            COALESCE(ct."porCanal", '[]'::json) AS contactos,
            COALESCE(c."dia", s."bFecha", s."creado") AS fecha,
            COUNT(*) OVER (PARTITION BY a."_id")::int AS conteo
       FROM src s
       JOIN "ACADEMICA" a ON a."_id" = s."academicaId"
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = s."eventoId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN "NIVELES" n ON n."curso" = p."tipoCurso" AND n."step" = COALESCE(c."step", s."bStep")
       -- Estado REAL del caso (vive en CASOS_ATENCION).
       LEFT JOIN "CASOS_ATENCION" ca ON ca."_id" = s."casoId"
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'canal', u.canal, 'resultado', u.resultado, 'fecha', u.fecha, 'intentos', u.intentos
                ) ORDER BY u.fecha DESC) AS "porCanal"
           FROM (
             SELECT DISTINCT ON (k."canal")
                    k."canal"::text AS canal, k."resultado"::text AS resultado, k."_createdDate" AS fecha,
                    COUNT(*) OVER (PARTITION BY k."canal")::int AS intentos
               FROM "CASOS_CONTACTOS" k
              WHERE k."casoId" = ca."_id"
              ORDER BY k."canal", k."_createdDate" DESC
           ) u
       ) ct ON true
       LEFT JOIN LATERAL (
         SELECT t."_id" FROM "PEOPLE" t
          WHERE t."contrato" = p."contrato" AND t."tipoUsuario" = 'TITULAR' LIMIT 1
       ) tit ON true
      WHERE ${where.join(' AND ')}
      -- Del caso más antiguo al más nuevo: lo que lleva más tiempo esperando va arriba.
      ORDER BY fecha ASC NULLS LAST, curso ASC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Opciones de dropdowns (sobre los casos abiertos)
  const opts = (await query(
    `WITH ${SRC_SQL}
     SELECT DISTINCT p."campaign" AS campaign, p."tipoCurso" AS curso, p."salon" AS salon,
            COALESCE(c."step", s."bStep") AS leccion,
            cc."guia" AS guia_id, g."nombreCompleto" AS guia_nombre
       FROM src s
       JOIN "ACADEMICA" a ON a."_id" = s."academicaId"
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = s."eventoId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
       LEFT JOIN "GUIAS" g ON g."_id"=cc."guia"
      WHERE COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`
  )).rows
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  const campanias = uniq(opts.map((o: any) => o.campaign)).sort()
  const cursos = uniq(opts.map((o: any) => o.curso)).sort()
  const salones = uniq(opts.map((o: any) => o.salon)).sort()
  const lecciones = uniq(opts.map((o: any) => o.leccion)).sort()
  const guias = Array.from(new Map(opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])).values())

  return successResponse({ rows, total: rows.length, campanias, cursos, salones, lecciones, guias })
})
