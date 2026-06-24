import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { TIPOS_CURSO, horariosFor, esMenores, addMonths } from '@/lib/cursos-campaign';

/**
 * PATCH /api/postgres/campaigns/[id]  → edita un curso de campaña (CURSOS_CAMPAIGN).
 * DELETE /api/postgres/campaigns/[id] → elimina el curso.
 * Gated por ACADEMICO.CAMPANA.CREAR.
 */
const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const PATCH = handlerWithAuth(async (request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');

  const cur = await query(
    `SELECT "_id","campaign","tipoCurso","horarioCurso","salon","numeroUsuarios","usuInscritos",
            "paraMenores","activa","duracionCurso",
            "inicioCurso"::text AS "inicioCurso", "inicioCampania"::text AS "inicioCampania",
            "finalCampaign"::text AS "finalCampaign"
     FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`,
    [id]
  );
  if (cur.rows.length === 0) throw new NotFoundError('Curso de campaña no encontrado');
  const row = cur.rows[0];
  const body = await request.json();

  // Merge de valores (lo enviado pisa lo actual)
  const tipoCurso = body.tipoCurso !== undefined ? String(body.tipoCurso) : row.tipoCurso;
  if (!(TIPOS_CURSO as readonly string[]).includes(tipoCurso)) throw new ValidationError(`Tipo de curso inválido: ${tipoCurso}`);
  const horarioCurso = body.horarioCurso !== undefined ? String(body.horarioCurso) : row.horarioCurso;
  // Grandfathering: si no cambian tipo ni horario, se acepta el valor guardado
  // aunque ya no esté en el catálogo (cursos creados con horarios antiguos).
  // Solo se valida contra el catálogo cuando el horario o el tipo cambian.
  const tipoOHorarioCambio = horarioCurso !== row.horarioCurso || tipoCurso !== row.tipoCurso;
  if (tipoOHorarioCambio && !horariosFor(tipoCurso).includes(horarioCurso)) {
    throw new ValidationError(`Horario inválido para ${tipoCurso}: ${horarioCurso}`);
  }

  const salon = body.salon !== undefined ? (String(body.salon).trim() || null) : row.salon;
  const inicioCurso = body.inicioCurso !== undefined ? (isDate(body.inicioCurso) ? body.inicioCurso : null) : (row.inicioCurso ? String(row.inicioCurso).slice(0, 10) : null);
  const duracion = body.duracionCurso !== undefined ? (parseInt(String(body.duracionCurso), 10) || 0) : (row.duracionCurso || 0);
  const numeroUsuarios = body.numeroUsuarios !== undefined ? (parseInt(String(body.numeroUsuarios), 10) || 0) : (row.numeroUsuarios || 0);
  if (numeroUsuarios <= 0) throw new ValidationError('El número de usuarios (cupos) debe ser > 0.');
  const inicioCampania = body.inicioCampania !== undefined ? (isDate(body.inicioCampania) ? body.inicioCampania : null) : (row.inicioCampania ? String(row.inicioCampania).slice(0, 10) : null);
  const finalCampaign = body.finalCampaign !== undefined ? (isDate(body.finalCampaign) ? body.finalCampaign : null) : (row.finalCampaign ? String(row.finalCampaign).slice(0, 10) : null);
  const activa = body.activa !== undefined ? !!body.activa : row.activa;
  // Final del curso = inicio + (duración + 1) meses
  const finalCurso = (inicioCurso && duracion > 0) ? addMonths(inicioCurso, duracion + 1) : null;

  // Si cambia (tipoCurso, horarioCurso), verificar que no choque con otro curso de la misma campaña
  if (tipoCurso !== row.tipoCurso || horarioCurso !== row.horarioCurso) {
    const dup = await query(
      `SELECT 1 FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 AND "_id" <> $4 LIMIT 1`,
      [row.campaign, tipoCurso, horarioCurso, id]
    );
    if (dup.rows.length > 0) throw new ConflictError(`Ya existe un curso ${tipoCurso} ${horarioCurso} en la campaña ${row.campaign}.`);
  }

  const upd = await query(
    `UPDATE "CURSOS_CAMPAIGN" SET
       "tipoCurso"=$1, "horarioCurso"=$2, "salon"=$3, "inicioCurso"=$4, "duracionCurso"=$5,
       "finalCurso"=$6, "numeroUsuarios"=$7, "inicioCampania"=$8, "finalCampaign"=$9,
       "paraMenores"=$10, "activa"=$11, "_updatedDate"=NOW()
     WHERE "_id"=$12 RETURNING *`,
    [tipoCurso, horarioCurso, salon, inicioCurso, duracion, finalCurso, numeroUsuarios, inicioCampania, finalCampaign, esMenores(tipoCurso), activa, id]
  );
  return successResponse({ curso: upd.rows[0] });
});

export const DELETE = handlerWithAuth(async (_request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');
  const del = await query(`DELETE FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1 RETURNING "_id"`, [id]);
  if (del.rows.length === 0) throw new NotFoundError('Curso de campaña no encontrado');
  return successResponse({ deleted: id });
});
