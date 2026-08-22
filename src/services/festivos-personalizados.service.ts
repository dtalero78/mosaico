import 'server-only';
import { queryMany, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { esFestivoChile } from '@/lib/festivos-chile';

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
    `SELECT "_id","fecha"::text AS "fecha","motivo","creadoPor","creadoPorNombre","_createdDate"
       FROM "FESTIVOS_PERSONALIZADOS" ORDER BY "fecha" ASC`
  ).catch(() => []); // tabla aún no creada → sin festivos
}

/**
 * Conjunto de fechas declaradas, para el generador de eventos.
 * Tolera que la tabla no exista todavía (deploy antes de la migración).
 */
export async function fechasFestivasPersonalizadas(): Promise<Set<string>> {
  const rows = await queryMany<{ fecha: string }>(
    `SELECT "fecha"::text AS "fecha" FROM "FESTIVOS_PERSONALIZADOS"`
  ).catch(() => []);
  return new Set(rows.map((r) => String(r.fecha).slice(0, 10)));
}

/** Cursos activos con clase ese día — el impacto de declarar el festivo. */
export async function impactoDeFecha(fecha: string) {
  const cursos = await queryMany<{
    _id: string; campaign: string; tipoCurso: string; salon: string | null;
    horarioCurso: string | null; alumnos: number;
  }>(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
            (SELECT COUNT(DISTINCT b."idEstudiante")::int FROM "ACADEMICA_BOOKINGS" b
              WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")) AS "alumnos"
       FROM "CALENDARIO" c
       JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
      WHERE c."fecha" = $1::date AND cc."activa" IS NOT FALSE
      ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`, [fecha]
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
export async function previsualizar(fecha: string) {
  const f = normalizarFecha(fecha);
  const yaDeclarado = await queryOne<{ motivo: string }>(
    `SELECT "motivo" FROM "FESTIVOS_PERSONALIZADOS" WHERE "fecha" = $1::date`, [f]
  ).catch(() => null);
  const { cursos, yaDictadas } = await impactoDeFecha(f);
  return {
    fecha: f,
    yaEsFestivo: esFestivoChile(f),
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
): Promise<{ festivo: FestivoPersonalizado; sesiones: number }> {
  const f = normalizarFecha(fecha);
  const m = String(motivo || '').trim();
  if (!m) throw new ValidationError('El motivo es obligatorio.');

  if (esFestivoChile(f)) {
    throw new ConflictError(
      `El ${f} ya es feriado del calendario de Chile — no hace falta declararlo, ese día ya no se dicta clase.`
    );
  }
  const dup = await queryOne<{ motivo: string }>(
    `SELECT "motivo" FROM "FESTIVOS_PERSONALIZADOS" WHERE "fecha" = $1::date`, [f]);
  if (dup) throw new ConflictError(`El ${f} ya está declarado como festivo: "${dup.motivo}".`);

  const { cursos } = await impactoDeFecha(f);
  const row = await queryOne<FestivoPersonalizado>(
    `INSERT INTO "FESTIVOS_PERSONALIZADOS" ("_id","fecha","motivo","creadoPor","creadoPorNombre")
     VALUES ($1,$2::date,$3,$4,$5)
     RETURNING "_id","fecha"::text AS "fecha","motivo","creadoPor","creadoPorNombre","_createdDate"`,
    [ids.comment(), f, m, actor.email || null, actor.nombre || null]
  );
  return { festivo: row!, sesiones: cursos.length };
}

/** Quita un festivo declarado. Los del calendario de Chile no se pueden quitar. */
export async function eliminarFestivo(id: string): Promise<{ fecha: string }> {
  const row = await queryOne<{ fecha: string }>(
    `DELETE FROM "FESTIVOS_PERSONALIZADOS" WHERE "_id" = $1 RETURNING "fecha"::text AS "fecha"`, [id]
  );
  if (!row) throw new NotFoundError('Festivo', id);
  return row;
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
      WHERE c."fecha" = ANY($1::date[]) AND cc."activa" IS NOT FALSE
        AND UPPER(cc."tipoCurso") <> 'IMPULSA'
      ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`, [norm]
  );
  return rows.map((cc) => ({
    _id: cc._id,
    nombre: `${cc.campaign} ${cc.tipoCurso}/${cc.salon || '—'}`,
  }));
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
      WHERE c."fecha" = ANY($1::date[]) AND cc."activa" IS NOT FALSE
        AND UPPER(cc."tipoCurso") <> 'IMPULSA'
      GROUP BY 1`, [festivos.map((f) => f.fecha)]
  );
  const byFecha = new Map(rows.map((r) => [String(r.fecha).slice(0, 10), r.n]));
  return festivos
    .map((f) => ({ fecha: f.fecha, motivo: f.motivo, sesiones: byFecha.get(f.fecha) || 0 }))
    .filter((x) => x.sesiones > 0);
}
