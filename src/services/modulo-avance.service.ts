import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { generateReport } from './progress.service';

/**
 * Auto-avance de MÓDULO de MOSAICO.
 *
 * Se llama tras guardar asistencia/evaluación. Si el MÓDULO ACTUAL del alumno quedó
 * COMPLETO — todas sus lecciones aprobadas Y su EVALUACIÓN aprobada por el Guía —,
 * avanza al alumno a la primera lección del módulo siguiente (ACADEMICA + PEOPLE).
 * Avanza de a un módulo por llamada; la siguiente marca avanza el siguiente si aplica.
 *
 * Idempotente y best-effort: si el módulo no está completo, o no hay siguiente, no hace
 * nada. No debe romper el guardado del Guía (el caller lo envuelve en try/catch).
 */
export async function autoAvanceModuloMosaico(academicaId: string): Promise<{ advanced: boolean; from?: string; to?: string }> {
  if (!academicaId) return { advanced: false };

  const report: any = await generateReport(academicaId);
  const modulos: any[] = report?.modulos || [];
  if (!modulos.length) return { advanced: false };

  const idx = modulos.findIndex((m) => m.esActual);
  const cur = idx >= 0 ? modulos[idx] : null;
  if (!cur || !cur.completo) return { advanced: false };

  const next = modulos[idx + 1];
  if (!next) return { advanced: false }; // último módulo del curso: no hay a dónde avanzar
  const nextLeccion = next.lecciones?.[0]?.leccion || null;
  if (!nextLeccion) return { advanced: false };

  const aca = await queryOne<{ _id: string; numeroId: string | null; nivel: string | null }>(
    `SELECT "_id","numeroId","nivel" FROM "ACADEMICA" WHERE "_id"=$1`, [academicaId]
  );
  if (!aca) return { advanced: false };
  if (aca.nivel === next.modulo) return { advanced: false }; // ya avanzado (carrera)

  const histEntry = JSON.stringify([{
    fecha: new Date().toISOString(),
    de: `${cur.modulo}`,
    a: `${next.modulo} - ${nextLeccion}`,
    motivo: 'Avance automático: módulo completo (lecciones + evaluación aprobadas)',
    realizadoPor: 'Sistema (avance de módulo)',
  }]);

  // ACADEMICA: nivel = módulo siguiente, step = su primera lección.
  await query(
    `UPDATE "ACADEMICA"
        SET "nivel"=$2, "step"=$3,
            "cambioStepHistory" = COALESCE("cambioStepHistory",'[]'::jsonb) || $4::jsonb,
            "_updatedDate"=NOW()
      WHERE "_id"=$1`,
    [academicaId, next.modulo, nextLeccion, histEntry]
  ).catch(async () => {
    // Si cambioStepHistory no existe como columna, actualiza sin historial.
    await query(`UPDATE "ACADEMICA" SET "nivel"=$2, "step"=$3, "_updatedDate"=NOW() WHERE "_id"=$1`,
      [academicaId, next.modulo, nextLeccion]);
  });

  // PEOPLE (beneficiario por numeroId): mantener nivel/step en sync.
  if (aca.numeroId) {
    await query(
      `UPDATE "PEOPLE" SET "nivel"=$2, "step"=$3, "_updatedDate"=NOW()
        WHERE "numeroId"=$1 AND "tipoUsuario"='BENEFICIARIO'`,
      [aca.numeroId, next.modulo, nextLeccion]
    ).catch(() => {});
  }

  return { advanced: true, from: cur.modulo, to: next.modulo };
}
