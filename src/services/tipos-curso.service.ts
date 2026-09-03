import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError, ConflictError, NotFoundError } from '@/lib/errors';
import { TIPOS_CURSO, CURSOS_MENORES } from '@/lib/cursos-campaign';

/**
 * Catálogo de tipos de curso.
 *
 * Vivía en la constante `TIPOS_CURSO`, así que cargar el currículo de un curso
 * nuevo en NIVELES no bastaba para poder usarlo: no salía en ningún desplegable
 * ni pasaba las validaciones del servidor. Ahora vive en TIPOS_CURSO_CATALOGO y
 * se administra desde Académico › Tipos de Curso.
 *
 * Dos reglas viajan con el curso porque NO se deducen del currículo:
 *   esMenores    → si el titular puede ser su propio alumno al crear el contrato
 *   usaApoderado → si el WhatsApp (bienvenida, recordatorios) va al apoderado
 * No coinciden: DANSHI no es de menores pero sus mensajes sí van al apoderado.
 *
 * La constante se conserva como RESPALDO: si la tabla no existe todavía (deploy
 * anterior a la migración) o la consulta falla, el catálogo cae a ella en vez de
 * quedarse vacío y bloquear el alta de cursos y contratos.
 */

export interface TipoCurso {
  _id: string;
  tipoCurso: string;
  esMenores: boolean;
  usaApoderado: boolean;
  orden: number;
  activo: boolean;
}

// Caché en memoria. El catálogo cambia muy de vez en cuando y lo consultan
// varios desplegables y validaciones por request.
const TTL_MS = 5 * 60 * 1000;
let cache: { data: TipoCurso[]; at: number } | null = null;

export function invalidarCacheTiposCurso(): void {
  cache = null;
}

/** Respaldo desde la constante, con las reglas tal como estaban en código. */
function respaldo(): TipoCurso[] {
  return (TIPOS_CURSO as readonly string[]).map((t, i) => ({
    _id: `fallback_${t}`,
    tipoCurso: t,
    esMenores: (CURSOS_MENORES as readonly string[]).includes(t),
    // La regla de apoderado incluía DANSHI además de los tres de menores.
    usaApoderado: (CURSOS_MENORES as readonly string[]).includes(t) || t === 'DANSHI',
    orden: i + 1,
    activo: true,
  }));
}

export async function listarTiposCurso(opts?: { incluirInactivos?: boolean }): Promise<TipoCurso[]> {
  const ahora = Date.now();
  if (!cache || ahora - cache.at > TTL_MS) {
    try {
      const res = await query<TipoCurso>(
        `SELECT "_id","tipoCurso","esMenores","usaApoderado","orden","activo"
           FROM "TIPOS_CURSO_CATALOGO"
          ORDER BY "orden", "tipoCurso"`
      );
      cache = { data: res.rows, at: ahora };
    } catch (err: any) {
      console.warn('[tipos-curso] catálogo no disponible, se usa el respaldo:', err?.message || err);
      return opts?.incluirInactivos ? respaldo() : respaldo();
    }
  }
  return opts?.incluirInactivos ? cache.data : cache.data.filter(t => t.activo);
}

/** Sólo los nombres activos, en orden — lo que alimenta los desplegables. */
export async function nombresTiposCurso(): Promise<string[]> {
  return (await listarTiposCurso()).map(t => t.tipoCurso);
}

/** ¿El nombre corresponde a un curso del catálogo (activo)? Valida altas. */
export async function esTipoCursoValido(tipo: string): Promise<boolean> {
  const t = String(tipo || '').trim().toUpperCase();
  if (!t) return false;
  return (await listarTiposCurso()).some(x => x.tipoCurso.toUpperCase() === t);
}

async function buscar(tipo: string): Promise<TipoCurso | undefined> {
  const t = String(tipo || '').trim().toUpperCase();
  return (await listarTiposCurso({ incluirInactivos: true }))
    .find(x => x.tipoCurso.toUpperCase() === t);
}

export async function esMenoresAsync(tipo: string): Promise<boolean> {
  return (await buscar(tipo))?.esMenores ?? false;
}

export async function usaApoderadoAsync(tipo: string): Promise<boolean> {
  return (await buscar(tipo))?.usaApoderado ?? false;
}

const NOMBRE_OK = /^[A-Z0-9ÁÉÍÓÚÑ][A-Z0-9ÁÉÍÓÚÑ \-]{1,58}$/;

export async function crearTipoCurso(input: {
  tipoCurso: string; esMenores?: boolean; usaApoderado?: boolean; orden?: number;
}): Promise<TipoCurso> {
  // Se normaliza a mayúsculas porque el nombre es la LLAVE: viaja como texto a
  // CURSOS_CAMPAIGN, PEOPLE, ACADEMICA y NIVELES. "Danshi" y "DANSHI" serían dos
  // cursos distintos para las consultas que comparan con igualdad.
  const nombre = String(input.tipoCurso || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!NOMBRE_OK.test(nombre)) {
    throw new ValidationError('El nombre sólo admite letras, números, espacios y guiones (2 a 59 caracteres)');
  }

  const dup = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "TIPOS_CURSO_CATALOGO" WHERE UPPER(TRIM("tipoCurso")) = $1`, [nombre]);
  if (dup) throw new ConflictError(`El curso "${nombre}" ya está en el catálogo`);

  const maxOrden = await queryOne<{ m: number }>(
    `SELECT COALESCE(MAX("orden"), 0) AS m FROM "TIPOS_CURSO_CATALOGO"`);

  const _id = `tcc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const res = await query<TipoCurso>(
    `INSERT INTO "TIPOS_CURSO_CATALOGO" ("_id","tipoCurso","esMenores","usaApoderado","orden")
     VALUES ($1,$2,$3,$4,$5)
     RETURNING "_id","tipoCurso","esMenores","usaApoderado","orden","activo"`,
    [_id, nombre, !!input.esMenores, !!input.usaApoderado,
     Number.isFinite(input.orden as number) ? input.orden : Number(maxOrden?.m ?? 0) + 1]
  );
  invalidarCacheTiposCurso();
  return res.rows[0];
}

export async function actualizarTipoCurso(id: string, cambios: {
  esMenores?: boolean; usaApoderado?: boolean; orden?: number; activo?: boolean;
}): Promise<TipoCurso> {
  // El NOMBRE no se edita: es la llave con la que los alumnos y los cursos de
  // campaña quedaron guardados. Renombrarlo aquí los dejaría apuntando a un
  // curso que ya no existe. Para corregir uno se crea el nuevo y se desactiva
  // el viejo — mismo criterio que en Horarios.
  const sets: string[] = [];
  const vals: any[] = [];
  for (const k of ['esMenores', 'usaApoderado', 'activo'] as const) {
    if (cambios[k] !== undefined) { vals.push(!!cambios[k]); sets.push(`"${k}" = $${vals.length}`); }
  }
  if (cambios.orden !== undefined && Number.isFinite(cambios.orden)) {
    vals.push(cambios.orden); sets.push(`"orden" = $${vals.length}`);
  }
  if (!sets.length) throw new ValidationError('Nada que actualizar');

  vals.push(id);
  const res = await query<TipoCurso>(
    `UPDATE "TIPOS_CURSO_CATALOGO" SET ${sets.join(', ')}, "_updatedDate" = NOW()
      WHERE "_id" = $${vals.length}
      RETURNING "_id","tipoCurso","esMenores","usaApoderado","orden","activo"`, vals);
  if (!res.rows[0]) throw new NotFoundError('Tipo de curso', id);
  invalidarCacheTiposCurso();
  return res.rows[0];
}
