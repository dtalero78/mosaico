import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, ForbiddenError } from '@/lib/errors';
import { getReporteAcademico, sanitizeCriterios, getCierre } from '@/services/reporte-academico.service';
import { query } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

/**
 * GET /api/postgres/reports/academico/reporte-academico
 *   Filtros: guia, curso, salon, campaign, startDate, endDate (default semana actual).
 *   RBAC: rol GUIA ve solo sus cursos; admin elige el guía. Gateado por REPORTE_ACADEMICO_VER.
 *
 * POST … (misma ruta): guarda la valoración del Guía por (estudiante, salón, semana).
 *   Body: { academicaId, numeroId?, curso?, salon, campaign?, semanaInicio, notaGuia }
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_VER);
  const sp = new URL(request.url).searchParams;
  const data = await getReporteAcademico({
    guia: sp.get('guia') || undefined,
    curso: sp.get('curso') || undefined,
    salon: sp.get('salon') || undefined,
    campaign: sp.get('campaign') || undefined,
    startDate: sp.get('startDate') || undefined,
    endDate: sp.get('endDate') || undefined,
  }, session);
  return successResponse(data);
});

/**
 * Guarda una fila del reporte por (estudiante, salón, semana). Cada campo se
 * actualiza SÓLO si viene en el body, para que guardar los criterios no borre el
 * comentario IA ni la actividad individual (y viceversa).
 */
async function guardarFila(item: any, salon: string, semanaInicio: string, email: string) {
  const academicaId = String(item?.academicaId || '').trim();
  if (!academicaId) throw new ValidationError('Falta academicaId.');

  const tieneCriterios = item?.criterios !== undefined;
  const tieneNota = item?.notaGuia !== undefined;
  const tieneIA = item?.comentarioIA !== undefined;

  const criterios = tieneCriterios ? sanitizeCriterios(item.criterios) : {};
  const notaGuia = tieneNota ? String(item.notaGuia ?? '') : null;
  const comentarioIA = tieneIA ? String(item.comentarioIA ?? '') : null;

  await query(
    `INSERT INTO "REPORTE_ACADEMICO_NOTAS"
       ("_id","academicaId","numeroId","curso","salon","campaign","semanaInicio","notaGuia","comentarioIA","criterios","updatedBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT ("academicaId","salon","semanaInicio") DO UPDATE SET
       "notaGuia"     = CASE WHEN $12 THEN EXCLUDED."notaGuia"     ELSE "REPORTE_ACADEMICO_NOTAS"."notaGuia"     END,
       "comentarioIA" = CASE WHEN $13 THEN EXCLUDED."comentarioIA" ELSE "REPORTE_ACADEMICO_NOTAS"."comentarioIA" END,
       "criterios"    = CASE WHEN $14 THEN EXCLUDED."criterios"    ELSE "REPORTE_ACADEMICO_NOTAS"."criterios"    END,
       "updatedBy"    = EXCLUDED."updatedBy",
       "_updatedDate" = NOW()`,
    [
      generateId('rep'), academicaId, item?.numeroId || null, item?.curso || null,
      salon, item?.campaign || null, semanaInicio,
      notaGuia, comentarioIA, JSON.stringify(criterios), email,
      tieneNota, tieneIA, tieneCriterios,
    ]
  );
}

/**
 * Comprueba que quien guarda pueda hacerlo según el estado del informe del salón.
 * Es la validación REAL (el front sólo oculta botones):
 *   BORRADOR     → cualquiera con acceso al reporte.
 *   CERRADO_GUIA → sólo con ACADEMICO.REPORTE_ACADEMICO.REVISAR (o admin).
 *   DEFINITIVO   → sólo SUPER_ADMIN.
 */
async function assertPuedeEscribir(session: any, curso: string, salon: string, campaign: string, semanaInicio: string) {
  if (!curso || !campaign) return; // sin curso/campaña no hay cierre que consultar
  const { estado } = await getCierre(curso, salon, campaign, semanaInicio);
  const rol = String((session as any)?.user?.role || '');

  if (estado === 'DEFINITIVO') {
    if (rol !== 'SUPER_ADMIN') {
      throw new ForbiddenError('El informe de esta semana ya tiene cierre definitivo y no se puede modificar.');
    }
    return;
  }
  if (estado === 'CERRADO_GUIA') {
    // requirePermission ya deja pasar a SUPER_ADMIN/ADMIN.
    await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_REVISAR);
  }
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_VER);
  const b = await request.json().catch(() => ({}));
  const salon = String(b?.salon || '').trim();
  const semanaInicio = String(b?.semanaInicio || '').trim();
  if (!salon || !semanaInicio) throw new ValidationError('Falta salon o semanaInicio.');
  const email = (session as any)?.user?.email || 'desconocido';

  // El informe cerrado no se puede seguir editando.
  const cursoBody = String(b?.curso || b?.items?.[0]?.curso || '').trim();
  const campaignBody = String(b?.campaign || b?.items?.[0]?.campaign || '').trim();
  await assertPuedeEscribir(session, cursoBody, salon, campaignBody, semanaInicio);

  // Guardado del informe completo: un solo POST con todas las filas del salón.
  if (Array.isArray(b?.items)) {
    if (!b.items.length) throw new ValidationError('No hay filas para guardar.');
    for (const item of b.items) await guardarFila(item, salon, semanaInicio, email);
    return successResponse({ ok: true, guardados: b.items.length });
  }

  // Guardado de un solo estudiante (compatibilidad con los botones por fila).
  await guardarFila(b, salon, semanaInicio, email);
  return successResponse({ ok: true, guardados: 1 });
});
