import 'server-only';
import { query, queryMany, queryOne } from '@/lib/postgres';

/**
 * "Repetir Lección" — camino B (mapeo sesión→lección).
 *
 * Cada sesión (evento de CALENDARIO ligado a un CURSOS_CAMPAIGN) cubre una lección
 * del curso, en secuencia por fecha. La secuencia base son las lecciones de NIVELES
 * (por `orden`); cada repetición autorizada DUPLICA su lección en el punto donde va,
 * empujando las siguientes una posición. Así el módulo/lección de cada sesión queda
 * registrado y el avance se "detiene" una lección tras cada repetición.
 */

export interface LeccionSeq { code: string; step: string }

/** Secuencia expandida = lecciones base + repeticiones autorizadas insertadas. */
export function expandirSecuencia(base: LeccionSeq[], repeticiones: Array<{ modulo: string; leccion: string }>): LeccionSeq[] {
  const seq = [...base];
  for (const rep of repeticiones) {
    const idx = seq.findIndex(l => l.code === rep.modulo && l.step === rep.leccion);
    if (idx >= 0) seq.splice(idx + 1, 0, seq[idx]); // duplica la lección repetida
  }
  return seq;
}

/** Lecciones base del curso (ordenadas por orden). */
export async function leccionesBaseCurso(tipoCurso: string): Promise<LeccionSeq[]> {
  const rows = await queryMany<{ code: string; step: string }>(
    `SELECT "code","step" FROM "NIVELES" WHERE "curso"=$1 ORDER BY "orden" NULLS LAST, "step"`, [tipoCurso]
  );
  return rows.map(r => ({ code: r.code, step: r.step }));
}

/**
 * Recalcula el mapeo sesión→lección de un salón (por cursoCampaignId). Asigna a cada
 * sesión (por fecha) la i-ésima lección de la secuencia expandida. Idempotente.
 * NO crea sesiones nuevas ni extiende — eso lo hace la autorización.
 */
export async function mapearLeccionesSalon(cursoCampaignId: string): Promise<number> {
  const cc = await queryOne<{ tipoCurso: string; historicRepet: any }>(
    `SELECT "tipoCurso","historicRepet" FROM "CURSOS_CAMPAIGN" WHERE "_id"=$1`, [cursoCampaignId]
  );
  if (!cc) return 0;

  const base = await leccionesBaseCurso(cc.tipoCurso);
  const hist = Array.isArray(cc.historicRepet) ? cc.historicRepet : [];
  const reps = hist.filter((h: any) => h?.modulo && h?.leccion).map((h: any) => ({ modulo: h.modulo, leccion: h.leccion }));
  const seq = expandirSecuencia(base, reps);

  const sesiones = await queryMany<{ _id: string }>(
    `SELECT "_id" FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 ORDER BY "dia" ASC`, [cursoCampaignId]
  );

  let n = 0;
  for (let i = 0; i < sesiones.length; i++) {
    const l = seq[i];
    await query(
      `UPDATE "CALENDARIO" SET "leccionOrden"=$2, "sesionModulo"=$3, "sesionLeccion"=$4, "_updatedDate"=NOW() WHERE "_id"=$1`,
      [sesiones[i]._id, l ? i + 1 : null, l?.code || null, l?.step || null]
    );
    n++;
  }
  return n;
}
