import 'server-only';
import { ValidationError } from '@/lib/errors';
import { normalizarSalon, type CursoRef } from '@/lib/curso-salon';

/**
 * Resuelve el curso de campaña (fila de CURSOS_CAMPAIGN) de una referencia
 * (campaña, tipo, horario[, salón]).
 *
 * Con el salón, la referencia es única. SIN salón sólo vale mientras el horario sea de un
 * único curso: si hay varios (dos salones del mismo tipo con el mismo horario) NO se adivina,
 * se pide el salón. Así los llamadores antiguos —que sólo conocen la terna— siguen
 * funcionando donde no hay duplicados y fallan con un mensaje claro donde sí.
 *
 * `db` es un pool o un cliente de transacción (cualquier cosa con `.query`).
 */
export async function resolverCurso<T = any>(
  db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  ref: CursoRef,
  opts: { soloActivo?: boolean; columnas?: string } = {}
): Promise<T | null> {
  const salon = normalizarSalon(ref.salon);
  const cols = opts.columnas || '*';
  const r = await db.query(
    `SELECT ${cols} FROM "CURSOS_CAMPAIGN"
      WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3
        ${salon ? `AND "salon"=$4` : ''}
        ${opts.soloActivo ? `AND "activa"=true` : ''}
      LIMIT 3`,
    salon ? [ref.campaign, ref.tipoCurso, ref.horarioCurso, salon] : [ref.campaign, ref.tipoCurso, ref.horarioCurso]
  );
  if (r.rows.length > 1) {
    throw new ValidationError(
      `Hay varios salones de ${ref.tipoCurso} con el horario ${ref.horarioCurso} en ${ref.campaign}: indique el salón.`
    );
  }
  return (r.rows[0] as T) ?? null;
}
