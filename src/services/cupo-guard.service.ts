import 'server-only';
import { cupoOcupadoSql } from '@/lib/cupo';
import { MENSAJE_SIN_CUPO } from '@/lib/cursos-campaign';
import { ValidationError } from '@/lib/errors';

/**
 * La guarda de cupo del salón, en UN solo sitio.
 *
 * Antes cada vía que metía a un alumno en un salón traía su propia copia del
 * conteo —y "Cambio Académico" directamente no traía ninguna—, así que la regla
 * "sin sobrecupo" se aplicaba o no según por dónde entrara el alumno.
 *
 * Dos cosas que sólo funcionan si se hacen juntas:
 *
 * 1. **El lock.** Contar y escribir son dos pasos; entre uno y otro cabe otra
 *    petición. Sin bloquear el salón, dos operaciones simultáneas leen "queda 1"
 *    las dos y lo toman las dos. El lock es por transacción: se suelta solo al
 *    terminar, no hay nada que liberar a mano.
 *
 * 2. **La misma clave.** El lock sólo excluye a quien calcula el MISMO entero,
 *    así que la clave se arma aquí y en ningún otro lado: dos módulos que la
 *    construyeran distinto no se verían entre sí y el lock no serviría de nada.
 */
export async function lockSalon(
  client: any, campaign: string, tipoCurso: string, horarioCurso: string
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `cupo:${campaign}|${tipoCurso}|${horarioCurso}`,
  ]);
}

/** Cuántos asientos están tomados AHORA en ese salón. `excluir`: quienes ya cuentan y se están moviendo. */
export async function contarOcupadosSalon(
  client: any, campaign: string, tipoCurso: string, horarioCurso: string, excluir: string[] = []
): Promise<number> {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" pe
      WHERE pe."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
        AND pe."campaign" = $1 AND pe."tipoCurso" = $2 AND pe."horarioCurso" = $3
        AND pe."_id" <> ALL($4::text[])
        AND ${cupoOcupadoSql('pe')}`,
    [campaign, tipoCurso, horarioCurso, excluir]
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Bloquea el salón, comprueba que quepa uno más y lanza si no.
 *
 * `excluir` es para quien YA ocupa asiento y se está moviendo dentro del mismo
 * salón (o confirmando su propia reserva): sin excluirlo se contaría a sí mismo y
 * se rechazaría solo.
 *
 * `cupos = 0` significa "sin límite declarado" — no se valida nada.
 *
 * **No hay override.** Para meter uno más se amplía el salón en Académico ›
 * Campañas; la única excepción es el sobrecupo autorizado de Gestión Contrato,
 * que lleva permiso propio y queda registrado en la ficha.
 */
export async function asegurarCupoSalon(
  client: any,
  destino: { campaign: string; tipoCurso: string; horarioCurso: string },
  opts: { excluir?: string[]; contexto?: string } = {}
): Promise<{ cupos: number; ocupados: number; salon: string | null }> {
  const { campaign, tipoCurso, horarioCurso } = destino;
  if (!campaign || !tipoCurso || !horarioCurso) return { cupos: 0, ocupados: 0, salon: null };

  await lockSalon(client, campaign, tipoCurso, horarioCurso);

  const cr = await client.query(
    `SELECT "salon", COALESCE("numeroUsuarios", 0)::int AS cupos FROM "CURSOS_CAMPAIGN"
      WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
    [campaign, tipoCurso, horarioCurso]
  );
  const salon: string | null = cr.rows[0]?.salon ?? null;
  const cupos = Number(cr.rows[0]?.cupos ?? 0);

  // Curso inexistente: no hay cupo que validar. Quien necesite exigir que exista
  // lo comprueba por su cuenta — el importador de PDF admite cursos sin enganche.
  if (!cr.rows.length || cupos === 0) return { cupos, ocupados: 0, salon };

  const ocupados = await contarOcupadosSalon(client, campaign, tipoCurso, horarioCurso, opts.excluir ?? []);
  if (ocupados >= cupos) {
    throw new ValidationError(
      `${MENSAJE_SIN_CUPO} (${tipoCurso} ${horarioCurso}${salon ? ` · Salón ${salon}` : ''}: ${ocupados}/${cupos})`
      + (opts.contexto ? ` — ${opts.contexto}` : '')
    );
  }
  return { cupos, ocupados, salon };
}
