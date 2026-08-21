import 'server-only';
import { randomUUID } from 'crypto';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query } from '@/lib/postgres';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, ConflictError } from '@/lib/errors';
import { TIPOS_CURSO, esMenores, addMonths, horariosSeSolapan } from '@/lib/cursos-campaign';
import { horarioEsValido } from '@/services/horarios-curso.service';
import { generarEventosCurso } from '@/services/cursos-campaign-eventos.service';
import { cupoOcupadoSql } from '@/lib/cupo';
import { detectarColisionesGuia, mensajeColision, guiaAsignado } from '@/services/colision-guia.service';
import { unirCursosEnGrupo } from '@/services/grupo-horario.service';
import { colisionesUnibles } from '@/lib/grupo-horario';

/**
 * GET /api/postgres/campaigns  → lista de cursos/campañas (admin Crea Campaña).
 * POST /api/postgres/campaigns → crea una campaña con sus cursos.
 * Gated por ACADEMICO.CAMPANA.CREAR.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  // Orden: campañas más recientes primero (por la fecha de creación más reciente
  // de la campaña) → tipo de curso en orden YOJI/OKINA/KODOMO/DANSHI/SENPAI/IMPULSA
  // → salón ascendente.
  const result = await query(
    `SELECT "_id","campaign","inicioCampania","finalCampaign","tipoCurso","salon","guia","horarioCurso","inicioCurso",
            "duracionCurso","finalCurso","numeroUsuarios","paraMenores","activa",
            -- cupos = beneficiarios cuyo contrato NO está rechazado/retractado/nulo (ver lib/cupo)
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
               WHERE pe."tipoUsuario"='BENEFICIARIO'
                 AND pe."campaign" = "CURSOS_CAMPAIGN"."campaign"
                 AND pe."tipoCurso" = "CURSOS_CAMPAIGN"."tipoCurso"
                 AND pe."horarioCurso" = "CURSOS_CAMPAIGN"."horarioCurso"
                 AND ${cupoOcupadoSql('pe')}) AS "usuInscritos"
     FROM "CURSOS_CAMPAIGN"
     ORDER BY
       MAX("_createdDate") OVER (PARTITION BY "campaign") DESC,
       "campaign",
       CASE "tipoCurso" WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
                        WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END,
       "salon"`
  );
  return successResponse({ rows: result.rows });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const body = await request.json();
  const { campaign, inicioCampania, finalCampaign, cursos } = body;

  if (!campaign || !String(campaign).trim()) throw new ValidationError('El nombre de la campaña es obligatorio.');
  if (!Array.isArray(cursos) || cursos.length === 0) throw new ValidationError('Agregue al menos un curso a la campaña.');

  const nombre = String(campaign).trim();
  const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const inicioCamp = isDate(inicioCampania) ? inicioCampania : null;
  const finalCamp  = isDate(finalCampaign) ? finalCampaign : null;
  const creados: any[] = [];
  // Cursos ya validados de ESTE envío, para detectar choques entre ellos.
  const enLote: Array<{ guia: string | null; tipoCurso: string; salon: string | null; horarioCurso: string; indice: number }> = [];
  // El INSERT va en una SEGUNDA pasada: primero se valida TODO el lote. Antes se
  // validaba e insertaba en el mismo bucle, así que un choque en el 3.º curso
  // dejaba los dos primeros ya creados — media campaña a medio hacer.
  // "Unir salones": el choque de guía deja de ser un error y pasa a declarar que
  // ese guía dicta los dos cursos a la vez. Como aquí el curso todavía NO existe,
  // la unión se hace al final, cuando ya tiene id: por eso cada fila arrastra con
  // quién debe unirse — un curso ya guardado (`unirCon`) o un compañero del propio
  // lote (`unirConIndice`), que tampoco existe hasta que se inserta.
  const unirSalones = body._unirSalones === true;
  const aInsertar: Array<{
    tipo: string; horario: string; salon: string | null; guia: string | null;
    inicioCurso: string | null; finalCurso: string | null; duracion: number; numeroUsuarios: number;
    unirCon: string[]; unirConIndice: number[];
  }> = [];

  for (const [indice, c] of (cursos as any[]).entries()) {
    const tipo = String(c?.tipoCurso || '');
    if (!(TIPOS_CURSO as readonly string[]).includes(tipo)) throw new ValidationError(`Tipo de curso inválido: ${tipo}`);
    const horario = String(c?.horarioCurso || '');
    // El catálogo vive en HORARIOS_CURSO (Académico › Horarios), ya no en el código.
    if (!(await horarioEsValido(tipo, horario))) throw new ValidationError(`Horario inválido para ${tipo}: ${horario}`);

    const salon = (c?.salon ? String(c.salon).trim() : null) || null;
    // Se normaliza aquí: el formulario puede mandar el texto 'null'/'undefined'
    // cuando no se elige guía, y guardarlo así lo convertía en un guía llamado «null».
    const guia = guiaAsignado(c?.guia);
    const inicioCurso = isDate(c?.inicioCurso) ? c.inicioCurso : null;
    const duracion = parseInt(String(c?.duracionCurso ?? 0), 10) || 0;
    // Final del curso = inicio + (duración + 1) meses.
    const finalCurso = (inicioCurso && duracion > 0) ? addMonths(inicioCurso, duracion + 1) : null;
    const numeroUsuarios = parseInt(String(c?.numeroUsuarios ?? 0), 10) || 0;
    if (numeroUsuarios <= 0) throw new ValidationError(`El curso ${tipo} ${horario} debe tener número de usuarios (cupos) > 0.`);

    // Un guía no puede dictar dos cursos a la vez: se revisa contra TODAS las
    // campañas activas, no sólo ésta (ver colision-guia.service). El INSERT es
    // un UPSERT, así que el propio curso se excluye por su clave natural.
    const colisiones = await detectarColisionesGuia({
      guia, campaign: nombre, tipoCurso: tipo, horarioCurso: horario, salon, inicioCurso, finalCurso,
      excluirClaveNatural: true,
    });
    const unirCon: string[] = [];
    const unirConIndice: number[] = [];
    if (colisiones.length) {
      if (unirSalones && colisionesUnibles({ campaign: nombre, horarioCurso: horario }, colisiones)) {
        const ids = colisiones.map((c: any) => String(c._id || '')).filter(Boolean);
        if (ids.length !== colisiones.length) {
          throw new ValidationError('Alguno de los cursos en conflicto aún no existe: guárdalo primero y únelos desde la pestaña Colisiones.');
        }
        unirCon.push(...ids);
      } else {
        // El detalle alimenta el modal que corrige la colisión (cambiar horario o
        // guía y reintentar): hace falta saber QUÉ curso del lote falló.
        throw new ConflictError(mensajeColision(colisiones), {
          tipo: 'colision_guia',
          indice,
          curso: { tipoCurso: tipo, salon, horarioCurso: horario, guia },
          colisiones,
          // El modal ofrece "Unir salones" sólo cuando de verdad se puede.
          unible: colisionesUnibles({ campaign: nombre, horarioCurso: horario }, colisiones),
        });
      }
    }

    // …y también contra los cursos del MISMO envío, que aún no están en la BD:
    // agregar dos salones al mismo guía y hora antes de guardar debe rechazarse.
    const choqueEnLote = enLote.find(l =>
      l.guia && guia && l.guia === guia && horariosSeSolapan(l.horarioCurso, horario)
    );
    if (choqueEnLote) {
      // Los dos cursos del choque son del MISMO envío y la misma campaña: unirlos
      // sólo tiene sentido si además comparten el horario exacto.
      const unibleEnLote = String(choqueEnLote.horarioCurso || '').trim().toUpperCase()
        === String(horario || '').trim().toUpperCase();
      if (unirSalones && unibleEnLote) {
        unirConIndice.push(choqueEnLote.indice);
        enLote.push({ guia, tipoCurso: tipo, salon, horarioCurso: horario, indice });
        aInsertar.push({ tipo, horario, salon, guia, inicioCurso, finalCurso, duracion, numeroUsuarios, unirCon, unirConIndice });
        continue;
      }
      throw new ConflictError(
        `El guía quedaría con dos cursos a la misma hora en esta campaña: ${choqueEnLote.tipoCurso}${choqueEnLote.salon ? ` · ${choqueEnLote.salon}` : ''} · ${choqueEnLote.horarioCurso} y ${tipo}${salon ? ` · ${salon}` : ''} · ${horario}.`,
        {
          tipo: 'colision_guia',
          indice,
          curso: { tipoCurso: tipo, salon, horarioCurso: horario, guia },
          colisiones: [{
            _id: null, campaign: nombre, tipoCurso: choqueEnLote.tipoCurso, salon: choqueEnLote.salon,
            horarioCurso: choqueEnLote.horarioCurso, inicioCurso: null, finalCurso: null,
            guiaNombre: null, vigenciaIndeterminada: false, mismoEnvio: true,
          }],
          unible: unibleEnLote,
        }
      );
    }
    enLote.push({ guia, tipoCurso: tipo, salon, horarioCurso: horario, indice });
    aInsertar.push({ tipo, horario, salon, guia, inicioCurso, finalCurso, duracion, numeroUsuarios, unirCon, unirConIndice });
  }

  // Segunda pasada: ya sabemos que el lote completo es válido.
  for (const { tipo, horario, salon, guia, inicioCurso, finalCurso, duracion, numeroUsuarios } of aInsertar) {
    const r = await query(
      `INSERT INTO "CURSOS_CAMPAIGN"
         ("_id","campaign","inicioCampania","finalCampaign","tipoCurso","salon","guia","horarioCurso","inicioCurso","duracionCurso","finalCurso","numeroUsuarios","usuInscritos","paraMenores","activa","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,true,NOW(),NOW())
       ON CONFLICT ("campaign","tipoCurso","horarioCurso") DO UPDATE SET
         "inicioCampania"=EXCLUDED."inicioCampania", "finalCampaign"=EXCLUDED."finalCampaign",
         "salon"=EXCLUDED."salon", "guia"=EXCLUDED."guia", "inicioCurso"=EXCLUDED."inicioCurso",
         "duracionCurso"=EXCLUDED."duracionCurso", "finalCurso"=EXCLUDED."finalCurso",
         "numeroUsuarios"=EXCLUDED."numeroUsuarios", "paraMenores"=EXCLUDED."paraMenores",
         "activa"=true, "_updatedDate"=NOW()
       RETURNING *`,
      [`ccp_${randomUUID()}`, nombre, inicioCamp, finalCamp, tipo, salon, guia, horario, inicioCurso, duracion, finalCurso, numeroUsuarios, esMenores(tipo)]
    );
    creados.push(r.rows[0]);

    // Generar los eventos de CALENDARIO para este curso (sesiones por horario+fechas).
    await generarEventosCurso({
      _id: r.rows[0]._id, campaign: nombre, tipoCurso: tipo, salon, guia,
      horarioCurso: horario, inicioCurso, finalCurso, numeroUsuarios,
    });
  }

  // Unir va al FINAL, cuando todos los cursos del lote ya tienen id. Cada grupo
  // se arma una sola vez: el curso recién creado más aquellos con los que choca
  // (ya guardados o del propio lote, resueltos ahora por su posición).
  const grupos: string[][] = [];
  for (const [i, fila] of aInsertar.entries()) {
    const destinos = [
      ...fila.unirCon,
      ...fila.unirConIndice.map(j => String(creados[j]?._id || '')).filter(Boolean),
    ];
    if (destinos.length) grupos.push([String(creados[i]._id), ...destinos]);
  }
  let unidos = 0;
  for (const ids of grupos) {
    await unirCursosEnGrupo(ids);
    unidos += ids.length;
  }

  return successResponse({ campaign: nombre, creados: creados.length, cursos: creados, unidos });
});
