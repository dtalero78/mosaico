import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError, ConflictError, NotFoundError } from '@/lib/errors';
import { TIPOS_CURSO, parseHorarioRango, horariosFor } from '@/lib/cursos-campaign';
import { ids } from '@/lib/id-generator';

/**
 * Catálogo de horarios por tipo de curso (`HORARIOS_CURSO`).
 *
 * Sólo alimenta el desplegable de "Agregar curso" y valida el alta/edición de
 * un curso de campaña. **Ninguna consulta de negocio pasa por aquí**: los
 * salones se siguen resolviendo por el texto de la terna
 * (campaign, tipoCurso, horarioCurso) contra CURSOS_CAMPAIGN y PEOPLE.
 *
 * Quitar un horario lo DESACTIVA: deja de ofrecerse para cursos nuevos y los
 * que ya lo usan siguen funcionando. No se renombra — para corregir uno se
 * agrega el nuevo y se desactiva el viejo, y los cursos se mueven desde
 * Campañas, que es el único sitio que sabe regenerar sus eventos.
 */

export interface HorarioCurso {
  _id: string;
  tipoCurso: string;
  horario: string;
  orden: number;
  activo: boolean;
  /** Cursos de campaña que lo usan (para avisar antes de desactivar). */
  cursos: number;
  alumnos: number;
}

/** Caché corto: el catálogo cambia a mano, muy de vez en cuando. */
const TTL_MS = 60 * 1000;
let cache: { value: Record<string, string[]>; expires: number } | null = null;

export function invalidarCacheHorarios() {
  cache = null;
}

/**
 * Horarios ACTIVOS por tipo de curso, como los espera el desplegable.
 *
 * Si la tabla todavía no existe (deploy antes de la migración) cae al catálogo
 * hardcodeado en vez de dejar el desplegable vacío, que bloquearía el alta de
 * cursos.
 */
export async function catalogoHorarios(): Promise<Record<string, string[]>> {
  if (cache && cache.expires > Date.now()) return cache.value;
  const out: Record<string, string[]> = {};
  try {
    const { rows } = await query<any>(
      `SELECT "tipoCurso", "horario" FROM "HORARIOS_CURSO"
        WHERE "activo" = true ORDER BY "tipoCurso", "orden", "horario"`
    );
    for (const r of rows) (out[r.tipoCurso] = out[r.tipoCurso] || []).push(r.horario);
  } catch {
    for (const t of TIPOS_CURSO) out[t] = horariosFor(t);
    return out; // sin cachear: que reintente en la próxima
  }
  if (!Object.keys(out).length) for (const t of TIPOS_CURSO) out[t] = horariosFor(t);
  cache = { value: out, expires: Date.now() + TTL_MS };
  return out;
}

/** ¿Ese horario está disponible para ese tipo de curso? */
export async function horarioEsValido(tipoCurso: string, horario: string): Promise<boolean> {
  const cat = await catalogoHorarios();
  return (cat[tipoCurso] || []).includes(horario);
}

/** Catálogo completo (incluye inactivos) + cuántos cursos y alumnos usa cada uno. */
export async function listarHorarios(): Promise<HorarioCurso[]> {
  const { rows } = await query<any>(
    `SELECT h."_id", h."tipoCurso", h."horario", h."orden", h."activo",
            (SELECT COUNT(*)::int FROM "CURSOS_CAMPAIGN" cc
              WHERE cc."tipoCurso" = h."tipoCurso" AND cc."horarioCurso" = h."horario") AS cursos,
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
              WHERE pe."tipoUsuario" = 'BENEFICIARIO'
                AND pe."tipoCurso" = h."tipoCurso" AND pe."horarioCurso" = h."horario") AS alumnos
       FROM "HORARIOS_CURSO" h
      ORDER BY h."tipoCurso", h."orden", h."horario"`
  );
  return rows.map(r => ({ ...r, orden: Number(r.orden), cursos: Number(r.cursos), alumnos: Number(r.alumnos) }));
}

/**
 * Alta de un horario.
 *
 * El formato se valida con el MISMO parser que genera los eventos
 * (`parseHorarioRango`): si no se puede interpretar, `generarEventosCurso`
 * produciría un curso sin ninguna clase — un horario mal escrito no rompe una
 * pantalla, rompe el calendario entero de sus alumnos.
 */
export async function crearHorario(input: {
  tipoCurso: string; horario: string; orden?: number; actor: string;
}): Promise<HorarioCurso> {
  const tipoCurso = String(input.tipoCurso || '').trim().toUpperCase();
  // Espacios de más y minúsculas se normalizan: el texto es la LLAVE del salón,
  // así que "SÁB  09:00-11:00" y "SÁB 09:00-11:00" no pueden convivir.
  const horario = String(input.horario || '').trim().replace(/\s+/g, ' ').toUpperCase();

  if (!TIPOS_CURSO.includes(tipoCurso as any)) {
    throw new ValidationError(`Tipo de curso no válido: ${input.tipoCurso}. Debe ser uno de ${TIPOS_CURSO.join(', ')}.`);
  }
  if (!horario) throw new ValidationError('Escribe el horario.');
  if (!parseHorarioRango(horario)) {
    throw new ValidationError(
      `No se entiende el horario "${horario}". Debe ser DÍAS seguidos de la franja, por ejemplo ` +
      `"LUN-MIÉ 17:00-18:00", "MAR-JUE 19:30-20:30", "SÁB 09:00-11:00" o "LUN-MIÉ-VIE 20:00-21:00". ` +
      `Con este formato se generan las clases del curso, así que uno mal escrito dejaría el calendario vacío.`
    );
  }

  const dup = await queryOne<any>(
    `SELECT "_id", "activo" FROM "HORARIOS_CURSO" WHERE "tipoCurso"=$1 AND "horario"=$2`,
    [tipoCurso, horario]
  );
  if (dup) {
    if (dup.activo) throw new ConflictError(`${tipoCurso} ya tiene el horario ${horario}.`);
    // Existía desactivado: reactivarlo es lo que el usuario quiere, no un error.
    await query(`UPDATE "HORARIOS_CURSO" SET "activo"=true, "_updatedDate"=NOW() WHERE "_id"=$1`, [dup._id]);
    invalidarCacheHorarios();
    return (await listarHorarios()).find(h => h._id === dup._id)!;
  }

  const orden = Number.isFinite(input.orden) ? Number(input.orden) : 999;
  const _id = ids.person().replace(/^prs_/, 'hor_');
  await query(
    `INSERT INTO "HORARIOS_CURSO" ("_id","tipoCurso","horario","orden","activo","creadoPor")
     VALUES ($1,$2,$3,$4,true,$5)`,
    [_id, tipoCurso, horario, orden, input.actor]
  );
  invalidarCacheHorarios();
  return (await listarHorarios()).find(h => h._id === _id)!;
}

/**
 * Activa o desactiva un horario. Desactivar NO borra ni mueve nada: sólo deja
 * de ofrecerse para cursos nuevos.
 */
export async function toggleHorario(id: string, activo: boolean): Promise<HorarioCurso> {
  const r = await query(
    `UPDATE "HORARIOS_CURSO" SET "activo"=$2, "_updatedDate"=NOW() WHERE "_id"=$1`,
    [id, activo]
  );
  if (!r.rowCount) throw new NotFoundError('Horario', id);
  invalidarCacheHorarios();
  return (await listarHorarios()).find(h => h._id === id)!;
}
