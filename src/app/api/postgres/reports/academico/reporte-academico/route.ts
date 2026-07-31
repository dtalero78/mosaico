import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { getReporteAcademico } from '@/services/reporte-academico.service';
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

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_VER);
  const b = await request.json().catch(() => ({}));
  const academicaId = String(b?.academicaId || '').trim();
  const salon = String(b?.salon || '').trim();
  const semanaInicio = String(b?.semanaInicio || '').trim();
  if (!academicaId || !salon || !semanaInicio) throw new ValidationError('Falta academicaId, salon o semanaInicio.');
  const notaGuia = String(b?.notaGuia ?? '');
  const email = (session as any)?.user?.email || 'desconocido';

  await query(
    `INSERT INTO "REPORTE_ACADEMICO_NOTAS" ("_id","academicaId","numeroId","curso","salon","campaign","semanaInicio","notaGuia","updatedBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT ("academicaId","salon","semanaInicio") DO UPDATE SET
       "notaGuia" = EXCLUDED."notaGuia", "updatedBy" = EXCLUDED."updatedBy", "_updatedDate" = NOW()`,
    [generateId('rep'), academicaId, b?.numeroId || null, b?.curso || null, salon, b?.campaign || null, semanaInicio, notaGuia, email]
  );
  return successResponse({ ok: true });
});
