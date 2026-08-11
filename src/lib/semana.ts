import 'server-only';
import { queryOne } from '@/lib/postgres';

/**
 * Instante UTC del inicio de la PRÓXIMA semana ISO (lunes 00:00 hora Chile).
 *
 * Se usa como CORTE para el historial de clases: se muestran las sesiones
 * pasadas + las de la semana corriente, y se ocultan las de semanas futuras
 * (`fechaEvento < corte`). El cálculo va en la BD (`AT TIME ZONE`) para respetar
 * el huso America/Santiago y el DST. `date_trunc('week', …)` toma el lunes como
 * inicio de semana (ISO 8601).
 */
export async function inicioProximaSemanaUTC(): Promise<number> {
  const r = await queryOne<{ cutoff: string }>(
    `SELECT (date_trunc('week', (NOW() AT TIME ZONE 'America/Santiago')) + INTERVAL '7 days')
              AT TIME ZONE 'America/Santiago' AS "cutoff"`
  );
  return r?.cutoff ? new Date(r.cutoff).getTime() : Infinity;
}
