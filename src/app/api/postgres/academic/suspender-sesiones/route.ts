import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import {
  listarSesiones, listarSuspensiones, previsualizar,
  type SesionFiltro,
} from '@/services/suspender-sesiones.service';

/**
 * GET /api/postgres/academic/suspender-sesiones
 *   ?campaign=&fecha=&fechaHasta=&guias=a,b&cursos=YOJI,OKINA&salones=id1,id2
 *   ?opciones=1  → sólo los catálogos de los dropdowns
 *
 * Devuelve las sesiones que cumplen el filtro + las suspensiones ya registradas.
 * Gateado por ACADEMICO.SUSPENDER_SESIONES.VER.
 */
const split = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SUSPENDER_SESIONES_VER);
  const { searchParams } = new URL(request.url);

  // Catálogos para los dropdowns: campañas, guías y cursos (con su salón+horario).
  const [campanias, guias, cursos] = await Promise.all([
    query<{ campaign: string }>(
      `SELECT DISTINCT "campaign" FROM "CURSOS_CAMPAIGN" WHERE "activa" = true ORDER BY "campaign" DESC`
    ),
    query<any>(
      `SELECT DISTINCT g."_id", g."nombreCompleto"
       FROM "GUIAS" g JOIN "CURSOS_CAMPAIGN" cc ON cc."guia" = g."_id"
       WHERE cc."activa" = true AND g."activo" = true
       ORDER BY g."nombreCompleto"`
    ),
    // El salón identifica al curso; se expone con su horario para que el dropdown
    // de salones muestre "Salón 06 — LUN-MIÉ 17:00-18:00", como se pidió.
    query<any>(
      `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
              cc."guia" AS "guiaId", g."nombreCompleto" AS "guiaNombre",
              cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso"
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       WHERE cc."activa" = true
       ORDER BY cc."campaign" DESC,
         CASE cc."tipoCurso" WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
                             WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END,
         cc."salon"`
    ),
  ]);

  const opciones = {
    campanias: campanias.rows.map(r => r.campaign),
    guias: guias.rows,
    cursos: cursos.rows,
  };

  if (searchParams.get('opciones')) return successResponse({ opciones });

  const filtro: SesionFiltro = {
    campaign: searchParams.get('campaign'),
    fecha: searchParams.get('fecha'),
    fechaHasta: searchParams.get('fechaHasta'),
    guias: split(searchParams.get('guias')),
    cursos: split(searchParams.get('cursos')),
    salones: split(searchParams.get('salones')),
  };

  const [sesiones, suspensiones] = await Promise.all([
    filtro.fecha ? listarSesiones(filtro) : Promise.resolve([]),
    listarSuspensiones(filtro.campaign),
  ]);

  return successResponse({ opciones, sesiones, suspensiones });
});

/**
 * POST /api/postgres/academic/suspender-sesiones
 * Body: { items: [{cursoCampaignId, fecha}], preview?: true }
 *
 * `preview: true` → devuelve el impacto SIN escribir (alimenta el modal).
 * Gateado por ACADEMICO.SUSPENDER_SESIONES.VER (sólo consulta).
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.SUSPENDER_SESIONES_VER);
  const body = await request.json();
  const cambios = await previsualizar(body?.items || []);
  return successResponse({ cambios });
});
