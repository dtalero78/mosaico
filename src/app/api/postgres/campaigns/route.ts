import 'server-only';
import { randomUUID } from 'crypto';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { TIPOS_CURSO, horariosFor, esMenores, addMonths } from '@/lib/cursos-campaign';

/**
 * GET /api/postgres/campaigns  → lista de cursos/campañas (admin Crea Campaña).
 * POST /api/postgres/campaigns → crea una campaña con sus cursos.
 * Gated por ACADEMICO.CAMPANA.CREAR.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const result = await query(
    `SELECT "_id","campaign","inicioCampania","tipoCurso","horarioCurso","inicioCurso",
            "duracionCurso","finalCurso","numeroUsuarios","usuInscritos","paraMenores","activa"
     FROM "CURSOS_CAMPAIGN"
     ORDER BY "campaign", "tipoCurso", "horarioCurso"`
  );
  return successResponse({ rows: result.rows });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const { campaign, inicioCampania, cursos } = await request.json();

  if (!campaign || !String(campaign).trim()) throw new ValidationError('El nombre de la campaña es obligatorio.');
  if (!Array.isArray(cursos) || cursos.length === 0) throw new ValidationError('Agregue al menos un curso a la campaña.');

  const nombre = String(campaign).trim();
  const creados: any[] = [];

  for (const c of cursos) {
    const tipo = String(c?.tipoCurso || '');
    if (!(TIPOS_CURSO as readonly string[]).includes(tipo)) throw new ValidationError(`Tipo de curso inválido: ${tipo}`);
    const horario = String(c?.horarioCurso || '');
    if (!horariosFor(tipo).includes(horario)) throw new ValidationError(`Horario inválido para ${tipo}: ${horario}`);

    const inicioCurso = (typeof c?.inicioCurso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.inicioCurso)) ? c.inicioCurso : null;
    const duracion = parseInt(String(c?.duracionCurso ?? 0), 10) || 0;
    const finalCurso = (inicioCurso && duracion > 0) ? addMonths(inicioCurso, duracion) : null;
    const numeroUsuarios = parseInt(String(c?.numeroUsuarios ?? 0), 10) || 0;
    if (numeroUsuarios <= 0) throw new ValidationError(`El curso ${tipo} ${horario} debe tener número de usuarios (cupos) > 0.`);
    const inicioCamp = (typeof inicioCampania === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inicioCampania)) ? inicioCampania : null;

    const r = await query(
      `INSERT INTO "CURSOS_CAMPAIGN"
         ("_id","campaign","inicioCampania","tipoCurso","horarioCurso","inicioCurso","duracionCurso","finalCurso","numeroUsuarios","usuInscritos","paraMenores","activa","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,true,NOW(),NOW())
       ON CONFLICT ("campaign","tipoCurso","horarioCurso") DO UPDATE SET
         "inicioCampania"=EXCLUDED."inicioCampania", "inicioCurso"=EXCLUDED."inicioCurso",
         "duracionCurso"=EXCLUDED."duracionCurso", "finalCurso"=EXCLUDED."finalCurso",
         "numeroUsuarios"=EXCLUDED."numeroUsuarios", "paraMenores"=EXCLUDED."paraMenores",
         "activa"=true, "_updatedDate"=NOW()
       RETURNING *`,
      [`ccp_${randomUUID()}`, nombre, inicioCamp, tipo, horario, inicioCurso, duracion, finalCurso, numeroUsuarios, esMenores(tipo)]
    );
    creados.push(r.rows[0]);
  }

  return successResponse({ campaign: nombre, creados: creados.length, cursos: creados });
});
