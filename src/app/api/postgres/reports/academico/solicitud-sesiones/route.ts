import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { queryMany } from '@/lib/postgres';

/**
 * GET /api/postgres/reports/academico/solicitud-sesiones
 *   [?guia=&curso=&salon=&startDate=&endDate=]
 *
 * Solicitudes de "Repetir Lección" PENDIENTES (repetirSesion=true, no autorizadas).
 * Filtros por guía, curso, salón y rango de fechas (sobre la fecha de solicitud).
 * Devuelve las filas + las opciones para los dropdowns. Gateado por
 * ACADEMICO.SOLICITUD_SESIONES.VER.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SOLICITUD_SESIONES_VER);
  const { searchParams } = new URL(request.url);
  const guia = searchParams.get('guia');
  const curso = searchParams.get('curso');
  const salon = searchParams.get('salon');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const rows = await queryMany(
    `SELECT c."_id", c."advisor", c."curso", c."salon", c."campaign", c."nivel", c."step",
            c."dia", c."repetirLeccion", c."fechaRepetirSesion", c."repetirMarcadoPor",
            COALESCE(g."nombreCompleto", c."advisor") AS "guiaNombre"
     FROM "CALENDARIO" c
     LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
     WHERE c."repetirSesion" = true AND c."autorizadoRepetir" IS NOT TRUE
       AND ($1::text IS NULL OR c."advisor" = $1)
       AND ($2::text IS NULL OR UPPER(c."curso") = UPPER($2))
       AND ($3::text IS NULL OR c."salon" = $3)
       AND ($4::timestamptz IS NULL OR c."fechaRepetirSesion" >= $4::timestamptz)
       AND ($5::timestamptz IS NULL OR c."fechaRepetirSesion" <= $5::timestamptz)
     ORDER BY c."fechaRepetirSesion" DESC NULLS LAST`,
    [guia || null, curso || null, salon || null,
     startDate ? `${startDate}T00:00:00` : null, endDate ? `${endDate}T23:59:59` : null]
  );

  // Opciones de filtro (del universo pendiente)
  const opciones = await queryMany<{ advisor: string; guiaNombre: string; curso: string; salon: string }>(
    `SELECT DISTINCT c."advisor", COALESCE(g."nombreCompleto", c."advisor") AS "guiaNombre", c."curso", c."salon"
     FROM "CALENDARIO" c LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
     WHERE c."repetirSesion" = true AND c."autorizadoRepetir" IS NOT TRUE`
  );
  const guias = Array.from(new Map(opciones.filter(o => o.advisor).map(o => [o.advisor, { id: o.advisor, nombre: o.guiaNombre }])).values());
  const cursos = Array.from(new Set(opciones.map(o => o.curso).filter(Boolean)));
  const salones = Array.from(new Set(opciones.map(o => o.salon).filter(Boolean)));

  return successResponse({ rows, opciones: { guias, cursos, salones }, total: rows.length });
});
