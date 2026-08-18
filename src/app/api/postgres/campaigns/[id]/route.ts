import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { TIPOS_CURSO, esMenores, addMonths } from '@/lib/cursos-campaign';
import { bookingConRegistroSql } from '@/lib/booking-registro';
import { horarioEsValido } from '@/services/horarios-curso.service';
import { generarEventosCurso, eliminarEventosCurso, regenerarCursoPreservandoEstado } from '@/services/cursos-campaign-eventos.service';
import { detectarColisionesGuia, mensajeColision, guiaAsignado } from '@/services/colision-guia.service';
import { deshacerGrupo } from '@/services/grupo-horario.service';

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
            "finalCampaign"::text AS "finalCampaign", "grupoHorarioId"
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
  if (tipoOHorarioCambio && !(await horarioEsValido(tipoCurso, horarioCurso))) {
    throw new ValidationError(`Horario inválido para ${tipoCurso}: ${horarioCurso}`);
  }

  const salon = body.salon !== undefined ? (String(body.salon).trim() || null) : row.salon;
  // Normalizado: el formulario puede mandar el texto 'null'/'undefined' cuando no
  // se elige guía, y guardarlo así lo volvía un guía llamado «null» que chocaba
  // contra cualquier otro curso sin guía.
  const guia = body.guia !== undefined ? guiaAsignado(body.guia) : guiaAsignado(row.guia);
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

  // ─── Curso agrupado al que le cambian el horario ───
  // Los cursos de un grupo de salón comparten guía y horario: si a uno le
  // cambian la hora, sus eventos pasan a otras fechas y se descuelga del grupo
  // en silencio. Antes de guardar hay que decidir qué se hace, así que sin una
  // instrucción explícita se rechaza y la UI pregunta.
  const cambiaHorario = horarioCurso !== row.horarioCurso;
  const accionGrupo = String(body._accionGrupoHorario || '').trim(); // 'propagar' | 'separar'
  if (row.grupoHorarioId && cambiaHorario && !accionGrupo) {
    const hermanos = (await query(
      `SELECT "_id","tipoCurso","salon","horarioCurso" FROM "CURSOS_CAMPAIGN"
        WHERE "grupoHorarioId" = $1 AND "_id" <> $2 ORDER BY "tipoCurso"`,
      [row.grupoHorarioId, id]
    )).rows;
    throw new ConflictError(
      'Este curso comparte salón con otros. Decide si el horario nuevo se aplica a todo el grupo o si el curso se separa.',
      {
        tipo: 'cambio_horario_grupo',
        cursoId: id,
        grupoHorarioId: row.grupoHorarioId,
        horarioAnterior: row.horarioCurso,
        horarioNuevo: horarioCurso,
        curso: { tipoCurso, salon, horarioCurso: row.horarioCurso },
        hermanos,
      }
    );
  }

  // Mover el grupo entero puede chocar con un curso que YA ocupa ese horario: la
  // campaña no admite dos cursos del mismo tipo a la misma hora, y el guard de
  // duplicado de más abajo sólo mira el curso editado, no a los hermanos que se
  // arrastran. Va ANTES del UPDATE: si fallara después, el curso quedaría con el
  // horario nuevo y el grupo a medio mover (pasó en pruebas).
  if (row.grupoHorarioId && cambiaHorario && accionGrupo === 'propagar') {
    const choques = (await query<{ tipoCurso: string; salon: string | null }>(
      `SELECT h."tipoCurso", otro."salon"
         FROM "CURSOS_CAMPAIGN" h
         JOIN "CURSOS_CAMPAIGN" otro
           ON otro."campaign" = h."campaign" AND otro."tipoCurso" = h."tipoCurso"
          AND otro."horarioCurso" = $1
          AND otro."grupoHorarioId" IS DISTINCT FROM h."grupoHorarioId"
        WHERE h."grupoHorarioId" = $2 AND h."_id" <> $3`,
      [horarioCurso, row.grupoHorarioId, id]
    )).rows;
    if (choques.length) {
      throw new ConflictError(
        `No se puede mover el grupo a ${horarioCurso}: ya hay ${choques
          .map(c => `${c.tipoCurso}${c.salon ? ` · Salón ${c.salon}` : ''}`)
          .join(', ')} en ese horario. Separa este curso del grupo o elige otro horario.`
      );
    }
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
      // Los hermanos del grupo comparten guía y hora a propósito: sin esto,
      // editar cualquier cosa de un curso agrupado lo bloquearían sus propios
      // compañeros de salón. Si se está separando, deja de tener grupo y sus
      // ex-hermanos vuelven a contar (aunque con horario distinto no chocarán).
      grupoHorarioId: accionGrupo === 'separar' ? null : row.grupoHorarioId,
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
  // ─── Efecto de la decisión sobre el grupo de salón ───
  // Se aplica ANTES de regenerar los eventos de este curso, para que la
  // regeneración ya use el estado final (con grupo o sin él).
  let grupoResultado: { accion: string; cursos: number } | null = null;
  if (row.grupoHorarioId && cambiaHorario && accionGrupo) {
    if (accionGrupo === 'propagar') {
      // El horario nuevo va para todo el grupo: siguen dictándose juntos.
      const hermanos = (await query<{ _id: string }>(
        `UPDATE "CURSOS_CAMPAIGN" SET "horarioCurso" = $1, "_updatedDate" = NOW()
          WHERE "grupoHorarioId" = $2 AND "_id" <> $3 RETURNING "_id"`,
        [horarioCurso, row.grupoHorarioId, id]
      )).rows;
      // Los hermanos cambian de fecha/hora → hay que regenerarlos, preservando
      // la asistencia ya marcada.
      for (const h of hermanos) await regenerarCursoPreservandoEstado(h._id);
      grupoResultado = { accion: 'propagar', cursos: hermanos.length + 1 };
    } else if (accionGrupo === 'separar') {
      // Este curso se va con su horario nuevo; los demás siguen como estaban.
      // `deshacerGrupo` disuelve el grupo si quedaba de 2 (uno solo no es grupo)
      // y regenera a los afectados para que pierdan el enlace.
      const r = await deshacerGrupo({ cursoId: id });
      grupoResultado = { accion: 'separar', cursos: r.afectados.length };
    } else {
      throw new ValidationError(`Acción de grupo desconocida: "${accionGrupo}".`);
    }
  }

  // Regenerar los eventos de CALENDARIO del curso con los nuevos datos.
  //
  // ⚠ `regenerarCursoPreservandoEstado` y NO `generarEventosCurso` a secas: el
  // segundo BORRA y recrea las filas de CALENDARIO, y los agendamientos de los
  // alumnos quedan apuntando a eventos que ya no existen — el guía abre su
  // sesión y ve "0 estudiantes" aunque el salón tenga 11. Pasó de verdad en
  // agosto-2026 (AGOSTO172026M · YOJI 01: 1.848 bookings huérfanos, y DANSHI 03)
  // simplemente por editar el curso desde Campañas.
  // La versión que preserva toma un snapshot del estado por (alumno, fecha),
  // regenera y lo vuelve a aplicar, así que la asistencia ya marcada no se pierde.
  await regenerarCursoPreservandoEstado(id);
  return successResponse({ curso: upd.rows[0], grupo: grupoResultado });
});

export const DELETE = handlerWithAuth(async (_request, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const id = ctx?.params?.id;
  if (!id) throw new ValidationError('id requerido');
  // Los agendamientos van ANTES que los eventos: si se borran los eventos primero,
  // las filas de sus alumnos quedan apuntando a un id muerto — así se perdieron
  // 5.236 agendamientos en agosto. Y si alguno ya tiene asistencia registrada no
  // se borra nada: un curso que ya se dictó no se elimina, se cierra.
  const conHistoria = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "ACADEMICA_BOOKINGS" b
     JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE c."cursoCampaignId" = $1 AND ${bookingConRegistroSql('b')}`,
    [id]
  );
  const n = conHistoria.rows[0]?.n ?? 0;
  if (n > 0) {
    throw new ValidationError(
      `No se puede eliminar el curso: ${n} agendamiento(s) ya tienen asistencia o evaluación registrada.`
    );
  }

  const del = await query(`DELETE FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1 RETURNING "_id"`, [id]);
  if (del.rows.length === 0) throw new NotFoundError('Curso de campaña no encontrado');

  await query(
    `DELETE FROM "ACADEMICA_BOOKINGS" b USING "CALENDARIO" c
     WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento") AND c."cursoCampaignId" = $1`,
    [id]
  );
  // Eliminar los eventos de CALENDARIO generados por este curso.
  await eliminarEventosCurso(id);
  return successResponse({ deleted: id });
});
