import 'server-only';
import crypto from 'crypto';
import { query } from '@/lib/postgres';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { motivoNoAgrupable, MAX_CURSOS_GRUPO } from '@/lib/grupo-horario';
import { chocanCursos, describirColision } from '@/services/colision-guia.service';
import { regenerarCursoPreservandoEstado } from '@/services/cursos-campaign-eventos.service';

/**
 * Grupos de salón: hasta 3 cursos de la misma campaña que comparten guía y
 * horario. El guía dicta UNA sesión y atiende a los alumnos de los 3 cursos;
 * la asistencia se marca por curso porque cada uno conserva sus propios eventos
 * y su propio roster.
 *
 * Unir/desagrupar sólo escribe `grupoHorarioId` en `CURSOS_CAMPAIGN` y regenera
 * los eventos: el `eventoCompartidoId` de cada evento se DERIVA de (grupo +
 * fecha/hora), así que el enlace entre hermanos aparece o desaparece solo.
 */

const CAMPOS_CURSO = `"_id","campaign","tipoCurso","salon","guia","horarioCurso",
  "inicioCurso"::text AS "inicioCurso","finalCurso"::text AS "finalCurso",
  "numeroUsuarios","grupoHorarioId"`;

export interface CursoGrupo {
  _id: string;
  campaign: string;
  tipoCurso: string;
  salon: string | null;
  guia: string | null;
  guiaNombre?: string | null;
  horarioCurso: string;
  inicioCurso: string | null;
  finalCurso: string | null;
  numeroUsuarios: number | null;
  grupoHorarioId: string | null;
}

async function cargarCursos(ids: string[]): Promise<CursoGrupo[]> {
  const r = await query<CursoGrupo>(
    `SELECT ${CAMPOS_CURSO}, (SELECT g."nombreCompleto" FROM "GUIAS" g WHERE g."_id" = cc."guia") AS "guiaNombre"
       FROM "CURSOS_CAMPAIGN" cc WHERE cc."_id" = ANY($1)`,
    [ids]
  );
  return r.rows;
}

/**
 * Une 2 o 3 cursos en un grupo de salón y regenera sus eventos para que queden
 * enlazados. Si alguno ya pertenecía a un grupo, se rechaza: primero hay que
 * deshacer el anterior (evita fusiones accidentales de dos grupos).
 */
export async function unirCursosEnGrupo(cursoIds: string[]): Promise<{
  grupoHorarioId: string;
  cursos: CursoGrupo[];
  eventosRegenerados: number;
  bookingsRegenerados: number;
}> {
  const idsUnicos = Array.from(new Set((cursoIds || []).map(s => String(s || '').trim()).filter(Boolean)));
  if (idsUnicos.length < 2) throw new ValidationError('Elige al menos 2 cursos para unir.');
  if (idsUnicos.length > MAX_CURSOS_GRUPO) {
    throw new ValidationError(`Un grupo admite máximo ${MAX_CURSOS_GRUPO} cursos (1 principal + 2 adicionales).`);
  }

  const cursos = await cargarCursos(idsUnicos);
  if (cursos.length !== idsUnicos.length) throw new NotFoundError('Curso de campaña', idsUnicos.join(', '));

  // Los que ya están agrupados deben pertenecer TODOS al mismo grupo: así el
  // grupo puede CRECER (adicionar el 3.º salón reenvía los 3 y se reutiliza su
  // id), pero no se fusionan dos grupos distintos por accidente.
  const gruposPrevios = Array.from(new Set(
    cursos.map(c => String(c.grupoHorarioId || '').trim()).filter(Boolean)
  ));
  if (gruposPrevios.length > 1) {
    throw new ValidationError('Esos cursos ya pertenecen a grupos distintos. Deshaz uno de los dos primero.');
  }

  const motivo = motivoNoAgrupable(cursos);
  if (motivo) throw new ValidationError(motivo);

  const grupoHorarioId = gruposPrevios[0] || crypto.randomUUID();

  // Al crecer un grupo hay que contar también a los miembros que NO vienen en la
  // lista, o se colaría un cuarto salón mandando sólo dos de los tres actuales.
  if (gruposPrevios[0]) {
    const { rows } = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "CURSOS_CAMPAIGN"
        WHERE "grupoHorarioId" = $1 AND NOT ("_id" = ANY($2))`,
      [grupoHorarioId, idsUnicos]
    );
    const final = idsUnicos.length + Number(rows[0]?.n || 0);
    if (final > MAX_CURSOS_GRUPO) {
      throw new ValidationError(`El grupo quedaría con ${final} salones y el máximo es ${MAX_CURSOS_GRUPO}.`);
    }
  }
  await query(
    `UPDATE "CURSOS_CAMPAIGN" SET "grupoHorarioId" = $1, "_updatedDate" = NOW() WHERE "_id" = ANY($2)`,
    [grupoHorarioId, idsUnicos]
  );

  // Regenerar para que los eventos nazcan con el eventoCompartidoId del grupo.
  // ⚠ `regenerarCursoPreservandoEstado` y NO `generarEventosCurso` a secas: el
  // segundo borra y recrea los eventos, dejando huérfanos los agendamientos de
  // los alumnos (en el primer caso real eran 279). Éste hace snapshot de la
  // asistencia, regenera y la vuelve a aplicar.
  let eventosRegenerados = 0;
  let bookingsRegenerados = 0;
  for (const c of cursos) {
    const r = await regenerarCursoPreservandoEstado(c._id);
    eventosRegenerados += r.eventos;
    bookingsRegenerados += r.bookings;
  }

  return { grupoHorarioId, cursos: await cargarCursos(idsUnicos), eventosRegenerados, bookingsRegenerados };
}

/**
 * Deshace un grupo (todos sus cursos) o saca UN curso del grupo.
 * Al quedar un solo curso, el grupo se disuelve: un "grupo" de uno no tiene
 * sentido y dejaría un eventoCompartidoId huérfano en sus eventos.
 */
export async function deshacerGrupo(opts: { grupoHorarioId?: string; cursoId?: string }): Promise<{
  afectados: CursoGrupo[];
  eventosRegenerados: number;
  bookingsRegenerados: number;
}> {
  let ids: string[] = [];

  if (opts.cursoId) {
    const [curso] = await cargarCursos([opts.cursoId]);
    if (!curso) throw new NotFoundError('Curso de campaña', opts.cursoId);
    if (!curso.grupoHorarioId) throw new ValidationError('Ese curso no pertenece a ningún grupo.');
    const hermanos = await query<{ _id: string }>(
      `SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE "grupoHorarioId" = $1`, [curso.grupoHorarioId]
    );
    // Sacar uno de un grupo de 2 disuelve el grupo entero.
    ids = hermanos.rows.length <= 2 ? hermanos.rows.map(r => r._id) : [opts.cursoId];
  } else if (opts.grupoHorarioId) {
    const r = await query<{ _id: string }>(
      `SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE "grupoHorarioId" = $1`, [opts.grupoHorarioId]
    );
    if (!r.rows.length) throw new NotFoundError('Grupo de salón', opts.grupoHorarioId);
    ids = r.rows.map(x => x._id);
  } else {
    throw new ValidationError('Falta el grupo o el curso a desagrupar.');
  }

  const antes = await cargarCursos(ids);
  await query(
    `UPDATE "CURSOS_CAMPAIGN" SET "grupoHorarioId" = NULL, "_updatedDate" = NOW() WHERE "_id" = ANY($1)`,
    [ids]
  );

  // Regenerar para que sus eventos pierdan el eventoCompartidoId, preservando
  // la asistencia ya marcada (igual que al unir).
  let eventosRegenerados = 0;
  let bookingsRegenerados = 0;
  for (const c of antes) {
    const r = await regenerarCursoPreservandoEstado(c._id);
    eventosRegenerados += r.eventos;
    bookingsRegenerados += r.bookings;
  }

  return { afectados: antes, eventosRegenerados, bookingsRegenerados };
}

export interface ColisionCampania {
  curso: CursoGrupo;
  /** El otro curso con el que choca. */
  contra: {
    _id: string; campaign: string; tipoCurso: string; salon: string | null;
    horarioCurso: string; inicioCurso: string | null; finalCurso: string | null;
    guiaNombre: string | null; vigenciaIndeterminada: boolean;
  };
  descripcion: string;
  /** true si los dos son de la misma campaña y el MISMO horario → se pueden unir. */
  unible: boolean;
}

/**
 * Colisiones de guía de una campaña: pares de cursos cuyo guía queda con dos
 * clases a la misma hora. Alimenta la pestaña "Colisiones" de Campañas, desde
 * donde se resuelven uniendo los salones (si son del mismo horario) o
 * corrigiendo el horario/guía.
 *
 * Los cursos que YA están en un grupo no chocan entre sí (`detectarColisionesGuia`
 * los excluye), así que unirlos hace desaparecer la fila.
 */
export async function colisionesDeCampania(campaign: string): Promise<{
  campaign: string;
  total: number;
  colisiones: ColisionCampania[];
  grupos: Array<{ grupoHorarioId: string; cursos: CursoGrupo[] }>;
}> {
  const camp = String(campaign || '').trim();
  if (!camp) throw new ValidationError('Falta la campaña.');

  // UNA sola consulta con TODOS los cursos activos con guía: las colisiones son
  // cross-campaña (el guía puede tener otro curso a la misma hora en una campaña
  // distinta), y cruzar 121 filas en memoria es instantáneo. Antes se llamaba a
  // `detectarColisionesGuia` por curso — una consulta cada uno — y una campaña de
  // 28 cursos tardaba 21 segundos.
  const todos = (await query<CursoGrupo>(
    `SELECT ${CAMPOS_CURSO}, (SELECT g."nombreCompleto" FROM "GUIAS" g WHERE g."_id" = cc."guia") AS "guiaNombre"
       FROM "CURSOS_CAMPAIGN" cc
      WHERE cc."activa" = true AND cc."guia" IS NOT NULL
      ORDER BY cc."horarioCurso", cc."tipoCurso", cc."salon"`
  )).rows;

  const cursos = todos.filter(c => c.campaign === camp);

  // Sólo hace falta comparar contra los cursos del MISMO guía.
  const porGuia = new Map<string, CursoGrupo[]>();
  for (const c of todos) {
    const g = String(c.guia || '').trim();
    if (!g) continue;
    const arr = porGuia.get(g) || [];
    arr.push(c);
    porGuia.set(g, arr);
  }

  const colisiones: ColisionCampania[] = [];
  const vistos = new Set<string>();

  for (const curso of cursos) {
    for (const otro of porGuia.get(String(curso.guia || '').trim()) || []) {
      if (otro._id === curso._id) continue;
      const { choca, vigenciaIndeterminada } = chocanCursos(curso, otro);
      if (!choca) continue;

      // Un choque A↔B se reporta UNA vez: la clave del par no depende del orden.
      const par = [curso._id, otro._id].sort().join('|');
      if (vistos.has(par)) continue;
      vistos.add(par);

      const contra = {
        _id: otro._id, campaign: otro.campaign, tipoCurso: otro.tipoCurso, salon: otro.salon,
        horarioCurso: otro.horarioCurso, inicioCurso: otro.inicioCurso, finalCurso: otro.finalCurso,
        guiaNombre: otro.guiaNombre ?? null, grupoHorarioId: otro.grupoHorarioId,
        vigenciaIndeterminada,
      };
      colisiones.push({
        curso,
        contra,
        descripcion: describirColision(contra as any),
        // Sólo se pueden unir cursos de la misma campaña y con el MISMO horario
        // (decisión del usuario); si los horarios sólo se solapan, hay que corregir.
        unible: otro.campaign === curso.campaign
          && String(otro.horarioCurso).trim() === String(curso.horarioCurso).trim()
          && !otro.grupoHorarioId && !curso.grupoHorarioId,
      });
    }
  }

  // Grupos ya declarados en la campaña, para mostrarlos como resueltos.
  const gruposMap = new Map<string, CursoGrupo[]>();
  for (const c of cursos) {
    if (!c.grupoHorarioId) continue;
    const arr = gruposMap.get(c.grupoHorarioId) || [];
    arr.push(c);
    gruposMap.set(c.grupoHorarioId, arr);
  }

  return {
    campaign: camp,
    total: colisiones.length,
    colisiones,
    grupos: Array.from(gruposMap.entries()).map(([grupoHorarioId, cs]) => ({ grupoHorarioId, cursos: cs })),
  };
}
