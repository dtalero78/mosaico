import 'server-only';
import { query } from '@/lib/postgres';
import { usaApoderadoAsync } from '@/services/tipos-curso.service';

/**
 * A qué número va el mensaje de bienvenida de un beneficiario.
 *
 * En los cursos de menores (YOJI/OKINA/KODOMO/DANSHI) el contacto es el
 * apoderado, así que el mensaje va a su teléfono; en SENPAI/IMPULSA el alumno es
 * adulto y va al suyo.
 *
 * Vive aquí y no dentro de un `route.ts` porque la MISMA regla la necesitan las
 * dos vías que mandan este mensaje: el botón "Mensaje de Bienvenida" de
 * `/student` y la aprobación del contrato. Estaban resolviendo distinto — la
 * aprobación enviaba siempre al `celular` de la ficha del beneficiario, y en 141
 * casos de cursos de menores ese número NO es el del apoderado.
 *
 * `beneficiarioId` admite un PEOPLE._id (`prs_`) o un ACADEMICA._id (`acd_`).
 * Best-effort: ante cualquier fallo se conserva el celular original, para que un
 * problema al resolver el destino nunca impida el envío.
 */
export async function resolverDestinoBienvenida(
  beneficiarioId: string,
  celularOriginal: string
): Promise<{ numero: string; usoApoderado: boolean }> {
  const fallback = { numero: celularOriginal, usoApoderado: false };
  try {
    // 1) como PEOPLE._id (caso sin-registro y aprobación)
    let row = (await query(
      `SELECT "tipoCurso", "apoderadoTelefono" FROM "PEOPLE" WHERE "_id" = $1 LIMIT 1`,
      [beneficiarioId]
    )).rows[0] as { tipoCurso?: string; apoderadoTelefono?: string } | undefined;

    // 2) si no, como ACADEMICA._id → PEOPLE por numeroId (prefiere BENEFICIARIO,
    //    porque titular y beneficiario pueden compartir documento)
    if (!row) {
      row = (await query(
        `SELECT p."tipoCurso", p."apoderadoTelefono"
           FROM "ACADEMICA" a
           JOIN LATERAL (
             SELECT "tipoCurso", "apoderadoTelefono" FROM "PEOPLE" p2
             WHERE p2."numeroId" = a."numeroId"
             ORDER BY CASE WHEN p2."tipoUsuario"='BENEFICIARIO' THEN 0 ELSE 1 END
             LIMIT 1
           ) p ON true
          WHERE a."_id" = $1 LIMIT 1`,
        [beneficiarioId]
      )).rows[0] as { tipoCurso?: string; apoderadoTelefono?: string } | undefined;
    }

    // La regla vive en el catálogo (TIPOS_CURSO_CATALOGO): un curso nuevo se
    // marca desde Académico › Tipos de Curso, sin tocar código.
    if (!row || !(await usaApoderadoAsync(row.tipoCurso || ''))) return fallback;

    const apoderadoDigitos = String(row.apoderadoTelefono || '').replace(/\D/g, '');
    // Apoderado sin teléfono utilizable → al alumno, antes que no enviar nada.
    if (apoderadoDigitos.length < 10) return fallback;
    return { numero: apoderadoDigitos, usoApoderado: true };
  } catch {
    return fallback;
  }
}
