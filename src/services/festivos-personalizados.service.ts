import 'server-only';
import { queryMany, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { esFestivoChile } from '@/lib/festivos-chile';
import { hoyEnChile } from '@/lib/cursos-campaign';

/**
 * Festivos personalizados — días sin clase que declara Académico, además de los
 * del calendario de Chile.
 *
 * El calendario legal ya lo resuelve `esFestivoChile` (los fijos y la Semana Santa
 * se calculan; los movibles salen de un JSON curado). Esto agrega los días que el
 * colegio decide no dictar: la semana de Fiestas Patrias, un puente, un cierre.
 *
 * **Sólo suma, nunca anula.** Si la fecha ya es feriado del calendario se avisa y
 * NO se guarda: el día ya está libre, y tenerlo por duplicado haría creer que
 * borrando el personalizado se recupera la clase.
 *
 * Es GLOBAL, a diferencia de `CURSOS_SUSPENSIONES`, que suspende un día de UN
 * curso concreto. Un feriado aplica a todos los cursos por igual.
 */

export interface FestivoPersonalizado {
  _id: string;
  fecha: string; // YYYY-MM-DD
  motivo: string;
  creadoPor: string | null;
  creadoPorNombre: string | null;
  _createdDate: string;
  /** A qué cursos aplica: TODOS (= MOSAICO; IMPULSA conserva su calendario) · MOSAICO · IMPULSA (sólo registro) · CURSOS (los de cursoIds). */
  alcance: Alcance;
  cursoIds: string[];
}

export type Alcance = 'TODOS' | 'MOSAICO' | 'IMPULSA' | 'CURSOS';
const ALCANCES: Alcance[] = ['TODOS', 'MOSAICO', 'IMPULSA', 'CURSOS'];

/**
 * Filtro SQL de un alcance sobre CURSOS_CAMPAIGN cc. IMPULSA queda FUERA de toda
 * regeneración: su calendario es propio (el motor de MOSAICO le borraría los
 * entrenamientos y evaluaciones), así que el alcance IMPULSA no afecta ningún curso.
 */
function filtroAlcance(alcance: Alcance, cursoIds: string[], idxParam: number): { sql: string; params: any[] } {
  if (alcance === 'IMPULSA') return { sql: ` AND UPPER(cc."tipoCurso") = 'IMPULSA' AND cc."_id" = ANY($${idxParam}::text[])`, params: [cursoIds] };
  if (alcance === 'CURSOS') return { sql: ` AND cc."_id" = ANY($${idxParam}::text[])`, params: [cursoIds] };
  return { sql: ` AND UPPER(cc."tipoCurso") <> 'IMPULSA'`, params: [] };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function normalizarFecha(fecha: string): string {
  const f = String(fecha || '').slice(0, 10);
  if (!ISO.test(f)) throw new ValidationError('La fecha debe venir como YYYY-MM-DD.');
  return f;
}

/** Todos los festivos declarados, del más próximo al más lejano. */
export async function listarFestivos(): Promise<FestivoPersonalizado[]> {
  return queryMany<FestivoPersonalizado>(
    `SELECT "_id","fecha"::text AS "fecha","motivo","creadoPor","creadoPorNombre","_createdDate","alcance","cursoIds"
       FROM "FESTIVOS_PERSONALIZADOS" ORDER BY "fecha" ASC`
  ).then((r) => r.map((x: any) => ({ ...x, alcance: (x.alcance || 'TODOS') as Alcance, cursoIds: Array.isArray(x.cursoIds) ? x.cursoIds : [] })))
   .catch(() => []); // tabla aún no creada → sin festivos
}

/**
 * Conjunto de fechas declaradas, para el generador de eventos.
 * Tolera que la tabla no exista todavía (deploy antes de la migración).
 */
export async function fechasFestivasPersonalizadas(): Promise<Set<string>> {
  const rows = await queryMany<{ fecha: string }>(
    `SELECT "fecha"::text AS "fecha" FROM "FESTIVOS_PERSONALIZADOS" WHERE "alcance" IN ('TODOS','MOSAICO')`
  ).catch(() => []);
  return new Set(rows.map((r) => String(r.fecha).slice(0, 10)));
}

/**
 * Fechas sin clase de UN curso por festivos declarados: los de alcance TODOS/MOSAICO
 * y los que lo nombran. IMPULSA nunca (calendario propio).
 */
export async function fechasFestivasDeCurso(cursoId: string, tipoCurso: string): Promise<Set<string>> {
  if (String(tipoCurso || '').toUpperCase() === 'IMPULSA') return new Set();
  const rows = await queryMany<{ fecha: string }>(
    `SELECT "fecha"::text AS "fecha" FROM "FESTIVOS_PERSONALIZADOS"
      WHERE "alcance" IN ('TODOS','MOSAICO') OR ("alcance" = 'CURSOS' AND "cursoIds" ? $1)`, [cursoId]
  ).catch(() => []);
  return new Set(rows.map((r) => String(r.fecha).slice(0, 10)));
}

/** Cursos activos con clase ese día — el impacto de declarar el festivo. */
export async function impactoDeFecha(fecha: string, alcance: Alcance = 'TODOS', cursoIds: string[] = []) {
  const fa = filtroAlcance(alcance, cursoIds, 2);
  const cursos = await queryMany<{
    _id: string; campaign: string; tipoCurso: string; salon: string | null;
    horarioCurso: string | null; alumnos: number;
  }>(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
            (SELECT COUNT(DISTINCT b."idEstudiante")::int FROM "ACADEMICA_BOOKINGS" b
              WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")) AS "alumnos"
       FROM "CALENDARIO" c
       JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
      WHERE c."fecha" = $1::date AND cc."activa" IS NOT FALSE AND (UPPER(cc."tipoCurso") <> 'IMPULSA' OR c."tipo" = 'SESSION')${fa.sql}
      ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`, [fecha, ...fa.params]
  );
  // Clases ya dictadas ese día: regenerar el curso borraría lo registrado.
  const dictadas = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
      WHERE c."fecha" = $1::date
        AND (b."asistio" IS TRUE OR b."asistencia" IS TRUE OR b."cancelo" IS TRUE
             OR b."participacion" IS TRUE OR b."noAprobo" IS TRUE OR b."calificacion" IS NOT NULL)`,
    [fecha]
  );
  return { cursos, yaDictadas: dictadas?.n || 0 };
}

/**
 * Qué pasaría al declarar esta fecha (sin escribir).
 * `yaEsFestivo` = el calendario de Chile ya la cubre → no hace falta declararla.
 */
export async function previsualizar(fecha: string, alcance: Alcance = 'TODOS', cursoIds: string[] = []) {
  const f = normalizarFecha(fecha);
  const yaDeclarado = await queryOne<{ motivo: string }>(
    `SELECT "motivo" FROM "FESTIVOS_PERSONALIZADOS" WHERE "fecha" = $1::date AND ("alcance" = 'IMPULSA') = $2`, [f, alcance === 'IMPULSA']
  ).catch(() => null);
  const { cursos, yaDictadas } = await impactoDeFecha(f, alcance, cursoIds);
  return {
    fecha: f,
    pasada: f < hoyEnChile(),
    yaEsFestivo: alcance === 'IMPULSA' ? false : esFestivoChile(f),
    yaDeclarado: yaDeclarado?.motivo || null,
    cursos,
    sesiones: cursos.length,
    alumnos: cursos.reduce((a, c) => a + (c.alumnos || 0), 0),
    yaDictadas,
  };
}

/** Declara un festivo. No guarda si el calendario de Chile ya cubre ese día. */
export async function crearFestivo(
  fecha: string, motivo: string, actor: { email?: string | null; nombre?: string | null },
  alcance: Alcance = 'TODOS', cursoIds: string[] = [],
): Promise<{ festivo: FestivoPersonalizado; sesiones: number }> {
  const f = normalizarFecha(fecha);
  // Sólo hacia adelante: un festivo en el pasado no se puede aplicar (las clases ya se dictaron).
  if (f < hoyEnChile()) throw new ValidationError('Los festivos sólo se pueden crear de hoy en adelante, no hacia atrás.');
  if (!ALCANCES.includes(alcance)) throw new ValidationError('Alcance inválido (TODOS, MOSAICO, IMPULSA o CURSOS).');
  const ids_ = Array.from(new Set((cursoIds || []).map(String).filter(Boolean)));
  if ((alcance === 'CURSOS' || alcance === 'IMPULSA') && !ids_.length) throw new ValidationError('Elige al menos un curso.');
  const m = String(motivo || '').trim();
  if (!m) throw new ValidationError('El motivo es obligatorio.');

  if (alcance !== 'IMPULSA' && esFestivoChile(f)) {
    throw new ConflictError(
      `El ${f} ya es feriado del calendario de Chile — no hace falta declararlo, ese día ya no se dicta clase.`
    );
  }
  const dup = await queryOne<{ motivo: string }>(
    `SELECT "motivo" FROM "FESTIVOS_PERSONALIZADOS" WHERE "fecha" = $1::date AND ("alcance" = 'IMPULSA') = $2`, [f, alcance === 'IMPULSA']);
  if (dup) throw new ConflictError(`El ${f} ya está declarado como festivo: "${dup.motivo}".`);

  const { cursos } = await impactoDeFecha(f, alcance, ids_);
  const row = await queryOne<FestivoPersonalizado>(
    `INSERT INTO "FESTIVOS_PERSONALIZADOS" ("_id","fecha","motivo","creadoPor","creadoPorNombre","alcance","cursoIds")
     VALUES ($1,$2::date,$3,$4,$5,$6,$7::jsonb)
     RETURNING "_id","fecha"::text AS "fecha","motivo","creadoPor","creadoPorNombre","_createdDate","alcance","cursoIds"`,
    [ids.comment(), f, m, actor.email || null, actor.nombre || null, alcance, JSON.stringify(alcance === 'CURSOS' || alcance === 'IMPULSA' ? ids_ : [])]
  );
  return { festivo: row!, sesiones: cursos.length };
}

/**
 * Cursos activos de un alcance cuyo calendario CRUZA esa fecha (empezaron antes y
 * tienen clases después): los que hay que restablecer al quitar un festivo para que
 * la clase vuelva a su día y se retire la que se había corrido al final.
 */
export async function cursosPorRestablecer(fecha: string, alcance: Alcance, cursoIds: string[] = []) {
  const f = normalizarFecha(fecha);
  const fa = filtroAlcance(alcance, cursoIds, 2);
  const rows = await queryMany<{ _id: string; campaign: string; tipoCurso: string; salon: string | null }>(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon"
       FROM "CURSOS_CAMPAIGN" cc
      WHERE cc."activa" IS NOT FALSE AND cc."inicioCurso" <= $1::date${fa.sql}
        AND EXISTS (SELECT 1 FROM "CALENDARIO" c WHERE c."cursoCampaignId" = cc."_id" AND c."fecha" > $1::date)
      ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`, [f, ...fa.params]);
  return rows.map((cc) => ({ _id: cc._id, nombre: `${cc.campaign} ${cc.tipoCurso}/${cc.salon || '—'}` }));
}

/**
 * Quita un festivo declarado (los del calendario de Chile no se pueden quitar).
 * En un festivo de CURSOS se puede quitar sólo para algunos (quitarCursoIds); si
 * quedan cursos, el festivo sigue para ellos. Devuelve los cursos a restablecer.
 */
export async function eliminarFestivo(id: string, quitarCursoIds?: string[]) {
  const f = await queryOne<{ fecha: string; alcance: Alcance; cursoIds: string[] }>(
    `SELECT "fecha"::text AS "fecha","alcance","cursoIds" FROM "FESTIVOS_PERSONALIZADOS" WHERE "_id" = $1`, [id]);
  if (!f) throw new NotFoundError('Festivo', id);
  const fecha = String(f.fecha).slice(0, 10);
  const actuales: string[] = Array.isArray(f.cursoIds) ? f.cursoIds : [];
  let quitados = actuales;
  if (f.alcance === 'CURSOS' && quitarCursoIds && quitarCursoIds.length) {
    quitados = actuales.filter((c) => quitarCursoIds.includes(c));
    const quedan = actuales.filter((c) => !quitarCursoIds.includes(c));
    if (quitados.length && quedan.length) {
      await queryOne(`UPDATE "FESTIVOS_PERSONALIZADOS" SET "cursoIds" = $2::jsonb WHERE "_id" = $1`, [id, JSON.stringify(quedan)]);
      return { fecha, alcance: f.alcance, parcial: true, cursos: await cursosPorRestablecer(fecha, 'CURSOS', quitados) };
    }
  }
  await queryOne(`DELETE FROM "FESTIVOS_PERSONALIZADOS" WHERE "_id" = $1`, [id]);
  return { fecha, alcance: f.alcance, parcial: false, cursos: f.alcance === 'IMPULSA' ? [] : await cursosPorRestablecer(fecha, f.alcance, quitados) };
}

/** Cursos activos (no IMPULSA) para elegir en un festivo de alcance CURSOS. */
export async function cursosParaElegir() {
  return queryMany<{ _id: string; campaign: string; tipoCurso: string; salon: string | null; horarioCurso: string | null }>(
    `SELECT "_id","campaign","tipoCurso","salon","horarioCurso" FROM "CURSOS_CAMPAIGN"
      WHERE "activa" IS NOT FALSE AND UPPER("tipoCurso") <> 'IMPULSA' AND "finalCurso" >= CURRENT_DATE
      ORDER BY "campaign" DESC, "tipoCurso", "salon"`);
}

/**
 * Cursos activos con clase en alguna de esas fechas — los que hay que recolocar.
 *
 * IMPULSA queda FUERA: su calendario no sale del horario semanal sino de una
 * configuración propia (sesiones L/M/V + entrenamientos y evaluaciones en fechas
 * fijas), y regenerarlo con el motor de MOSAICO le borraría los entrenamientos y
 * las evaluaciones y los reemplazaría por sesiones sueltas. Sus días sin clase se
 * cargan en su propio asistente (Académico › Crear IMPULSA), y se listan aparte
 * para que nadie crea que quedaron cubiertos.
 */
export async function cursosDeFechas(fechas: string[]) {
  const norm = fechas.map(normalizarFecha);
  const rows = await queryMany<{ _id: string; campaign: string; tipoCurso: string; salon: string | null }>(
    `SELECT DISTINCT cc."_id", cc."campaign", cc."tipoCurso", cc."salon"
       FROM "CALENDARIO" c
       JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
      JOIN "FESTIVOS_PERSONALIZADOS" f ON f."fecha" = c."fecha"
       AND ((f."alcance" IN ('TODOS','MOSAICO') AND UPPER(cc."tipoCurso") <> 'IMPULSA')
         OR (f."alcance" = 'CURSOS' AND f."cursoIds" ? cc."_id"))
      WHERE c."fecha" = ANY($1::date[]) AND cc."activa" IS NOT FALSE
      ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`, [norm]
  );
  return rows.map((cc) => ({
    _id: cc._id,
    nombre: `${cc.campaign} ${cc.tipoCurso}/${cc.salon || '—'}`,
  }));
}

/**
 * Eventos SUELTOS que caen en un día sin clase — no pertenecen a ningún curso de
 * campaña (Welcome, nivelaciones, talleres creados a mano), así que no hay "final
 * de curso" al que correrlos: se mueven o se eliminan desde el calendario.
 *
 * Se listan tanto los que caen en un festivo declarado como en un feriado legal:
 * hasta ahora nada impedía crearlos ahí, y llegó a haber un Welcome el 18 de
 * septiembre. Los nuevos ya quedan bloqueados al crearse.
 */
export async function eventosSueltosEnFestivos() {
  const declarados = await listarFestivos();
  const rows = await queryMany<{
    _id: string; fecha: string; hora: string | null; tipo: string;
    titulo: string | null; guia: string | null; inscritos: number;
  }>(
    `SELECT c."_id", c."fecha"::text AS "fecha", c."hora", c."tipo",
            COALESCE(c."tituloONivel", c."titulo") AS "titulo",
            g."nombreCompleto" AS "guia",
            (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" b
              WHERE b."eventoId" = c."_id" OR b."idEvento" = c."_id") AS "inscritos"
       FROM "CALENDARIO" c
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE c."cursoCampaignId" IS NULL AND c."dia" >= NOW() - INTERVAL '1 day'
      ORDER BY c."dia"`
  );
  const dec = new Set(declarados.map((f) => f.fecha));
  return rows
    .map((r) => ({ ...r, fecha: String(r.fecha).slice(0, 10) }))
    .filter((r) => dec.has(r.fecha) || esFestivoChile(r.fecha))
    .map((r) => ({ ...r, motivo: dec.has(r.fecha) ? 'declarado' : 'feriado legal' }));
}

/** Clases de IMPULSA que caen en esas fechas — hay que resolverlas en su asistente. */
export async function impulsaEnFechas(fechas: string[]) {
  const norm = fechas.map(normalizarFecha);
  return queryMany<{ fecha: string; hora: string | null; tipo: string; curso: string }>(
    `SELECT c."fecha"::text AS "fecha", c."hora", c."tipo",
            cc."campaign" || ' ' || cc."tipoCurso" || '/' || COALESCE(cc."salon",'—') AS "curso"
       FROM "CALENDARIO" c
       JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
      WHERE c."fecha" = ANY($1::date[]) AND cc."activa" IS NOT FALSE
        AND UPPER(cc."tipoCurso") = 'IMPULSA'
      ORDER BY c."dia"`, [norm]
  );
}

/**
 * Regenera UN curso para que su calendario refleje los festivos: los eventos ya
 * creados no se mueven solos.
 *
 * Usa `regenerarCursoPreservandoEstado` —no `generarEventosCurso`— porque el
 * segundo deja huérfanos los agendamientos de los alumnos.
 */
export async function regenerarUnCurso(cursoId: string) {
  const curso = await queryOne<{ tipoCurso: string }>(
    `SELECT "tipoCurso" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoId]);
  if (!curso) throw new NotFoundError('Curso', cursoId);
  // Guarda dura, no sólo el filtro de la lista: el motor de MOSAICO reconstruye el
  // calendario desde el horario semanal, y en un curso IMPULSA eso borraría sus
  // entrenamientos y evaluaciones.
  if (String(curso.tipoCurso || '').toUpperCase() === 'IMPULSA') {
    throw new ValidationError(
      'IMPULSA no se regenera desde aquí: su calendario se materializa en Académico › Crear IMPULSA, con sus propios días sin clase.'
    );
  }
  const { regenerarCursoPreservandoEstado } = await import('./cursos-campaign-eventos.service');
  const r = await regenerarCursoPreservandoEstado(cursoId);
  return { eventos: r.eventos, bookings: r.bookings, alumnos: r.alumnos };
}

/**
 * Festivos declarados que todavía tienen clases agendadas — falta recolocarlas.
 *
 * Excluye IMPULSA por la misma razón que `cursosDeFechas`: sus clases no se pueden
 * recolocar desde aquí, así que contarlas dejaría un pendiente que el botón nunca
 * puede resolver. Se listan aparte, con su propia explicación.
 */
export async function festivosConSesionesPendientes(): Promise<Array<{ fecha: string; motivo: string; sesiones: number }>> {
  const festivos = await listarFestivos();
  if (!festivos.length) return [];
  const rows = await queryMany<{ fecha: string; n: number }>(
    `SELECT c."fecha"::text AS "fecha", COUNT(*)::int AS n
       FROM "CALENDARIO" c
       JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
       JOIN "FESTIVOS_PERSONALIZADOS" f ON f."fecha" = c."fecha"
        AND ((f."alcance" IN ('TODOS','MOSAICO') AND UPPER(cc."tipoCurso") <> 'IMPULSA')
          OR (f."alcance" = 'CURSOS' AND f."cursoIds" ? cc."_id"))
      WHERE c."fecha" = ANY($1::date[]) AND cc."activa" IS NOT FALSE
      GROUP BY 1`, [festivos.map((f) => f.fecha)]
  );
  const byFecha = new Map(rows.map((r) => [String(r.fecha).slice(0, 10), r.n]));
  return festivos
    .map((f) => ({ fecha: f.fecha, motivo: f.motivo, sesiones: byFecha.get(f.fecha) || 0 }))
    .filter((x) => x.sesiones > 0);
}
