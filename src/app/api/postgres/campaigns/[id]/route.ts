import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { TIPOS_CURSO, horariosFor, esMenores, addMonths } from '@/lib/cursos-campaign';
import { generarEventosCurso, eliminarEventosCurso } from '@/services/cursos-campaign-eventos.service';
import { detectarColisionesGuia, mensajeColision } from '@/services/colision-guia.service';

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
    `SELECT "_id","campaign","tipoCurso","horarioCurso","salon","guia","numeroUsuarios","usuInscritos",
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
  const guia = body.guia !== undefined ? (String(body.guia).trim() || null) : row.guia;
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

  // Un guía no puede dictar dos cursos a la vez: se revisa contra TODAS las
  // campañas activas (no sólo ésta) y sólo cuando las vigencias se solapan.
  //
  // Grandfathering — la verificación corre SÓLO si el cambio toca el horario del
  // guía (guía, tipo, horario o vigencia). Al activarse esta regla ya existían
  // cursos cruzados en la base; sin esta guarda, corregirles los cupos o el
  // salón quedaría bloqueado para siempre por un cruce que ya estaba ahí. Lo que
  // se impide es CREAR un cruce nuevo, no editar lo demás de uno viejo.
  const rowInicio = row.inicioCurso ? String(row.inicioCurso).slice(0, 10) : null;
  const horarioDelGuiaCambio =
    guia !== row.guia ||
    tipoCurso !== row.tipoCurso ||
    horarioCurso !== row.horarioCurso ||
    inicioCurso !== rowInicio ||
    duracion !== (row.duracionCurso || 0);
  if (horarioDelGuiaCambio) {
    const colisiones = await detectarColisionesGuia({
      excluirId: id, guia, campaign: row.campaign, tipoCurso, horarioCurso, salon, inicioCurso, finalCurso,
    });
    if (colisiones.length) {
      throw new ConflictError(mensajeColision(colisiones), {
        tipo: 'colision_guia',
        cursoId: id,
        curso: { tipoCurso, salon, horarioCurso, guia },
        colisiones,
      });
    }
  }

  const upd = await query(
    `UPDATE "CURSOS_CAMPAIGN" SET
       "tipoCurso"=$1, "horarioCurso"=$2, "salon"=$3, "guia"=$4, "inicioCurso"=$5, "duracionCurso"=$6,
       "finalCurso"=$7, "numeroUsuarios"=$8, "inicioCampania"=$9, "finalCampaign"=$10,
       "paraMenores"=$11, "activa"=$12, "_updatedDate"=NOW()
     WHERE "_id"=$13 RETURNING *`,
    [tipoCurso, horarioCurso, salon, guia, inicioCurso, duracion, finalCurso, numeroUsuarios, inicioCampania, finalCampaign, esMenores(tipoCurso), activa, id]
  );
  // Regenerar eventos de CALENDARIO del curso con los nuevos datos.
  // `grupoHorarioId` se toma de la fila ACTUALIZADA: si el curso pertenece a un
  // grupo de salón, sus eventos vuelven a enlazarse con los de los hermanos (el
  // enlace se deriva, así que regenerar no lo pierde).
  await generarEventosCurso({
    _id: id, campaign: row.campaign, tipoCurso, salon, guia,
    horarioCurso, inicioCurso, finalCurso, numeroUsuarios,
    grupoHorarioId: upd.rows[0]?.grupoHorarioId ?? null,
  });
  return successResponse({ curso: upd.rows[0] });
});

export const DELETE = handlerWithAuth(async (_request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');
  const del = await query(`DELETE FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1 RETURNING "_id"`, [id]);
  if (del.rows.length === 0) throw new NotFoundError('Curso de campaña no encontrado');
  // Eliminar los eventos de CALENDARIO generados por este curso.
  await eliminarEventosCurso(id);
  return successResponse({ deleted: id });
});
