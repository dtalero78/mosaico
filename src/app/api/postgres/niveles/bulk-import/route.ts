import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { withTransaction, query } from '@/lib/postgres';

/**
 * POST /api/postgres/niveles/bulk-import
 *
 * Crea/reemplaza un CURSO en NIVELES desde filas parseadas de un CSV
 * (Subir Curso). Reusa la lógica de scripts/seed-niveles-curso.js:
 *   1 fila por curso+módulo+lección → NIVELES (curso, code=módulo, step=lección,
 *   description, descripcionModulo, orden). Idempotente por curso (borra las filas
 *   del curso y reinserta). Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 *
 * Body: { curso, apply, rows: [{ modulo, descripcionModulo?, leccion, descripcion?, orden? }] }
 *   apply=false → dry-run (valida + devuelve resumen). apply=true → escribe.
 */
interface ImportRow {
  modulo?: string;
  descripcionModulo?: string;
  leccion?: string;
  descripcion?: string;
  orden?: number | string;
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const body = await request.json();
  const curso = String(body?.curso || '').trim();
  const apply = body?.apply === true;
  const rawRows: ImportRow[] = Array.isArray(body?.rows) ? body.rows : [];

  if (!curso) throw new ValidationError('Falta el curso.');
  if (!rawRows.length) throw new ValidationError('No hay filas para importar.');

  // Normalizar filas. Módulo y lección son obligatorios; el orden se toma del
  // número de la lección (o del índice si no tiene número).
  const norm = rawRows.map((r, i) => {
    const modulo = String(r.modulo || '').trim();
    const leccion = String(r.leccion || '').trim();
    const m = leccion.match(/(\d+)/);
    const orden = Number(r.orden) || (m ? parseInt(m[1], 10) : i + 1);
    return {
      modulo,
      descMod: String(r.descripcionModulo || '').trim(),
      leccion,
      descLec: String(r.descripcion || '').trim(),
      orden,
    };
  });

  const invalid = norm.findIndex(r => !r.modulo || !r.leccion);
  if (invalid >= 0) {
    throw new ValidationError(`Fila ${invalid + 1}: módulo y lección son obligatorios.`);
  }

  // No permitir lección duplicada dentro del mismo módulo (rompería el índice único).
  const seen = new Set<string>();
  for (let i = 0; i < norm.length; i++) {
    const key = `${norm[i].modulo}||${norm[i].leccion}`;
    if (seen.has(key)) {
      throw new ValidationError(`Fila ${i + 1}: lección duplicada en el mismo módulo (${norm[i].modulo} · ${norm[i].leccion}).`);
    }
    seen.add(key);
  }

  const porModulo: Record<string, number> = {};
  norm.forEach(r => { porModulo[r.modulo] = (porModulo[r.modulo] || 0) + 1; });

  // Cuántas filas tiene hoy el curso (para avisar que se reemplazará)
  const actual = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "NIVELES" WHERE "curso" = $1`, [curso]
  );
  const existentes = actual.rows[0]?.n ?? 0;

  if (!apply) {
    return successResponse({
      preview: true, curso, total: norm.length, porModulo, existentes,
      inicio: { code: norm[0].modulo, step: norm[0].leccion, orden: norm[0].orden },
    });
  }

  await withTransaction(async (client) => {
    await client.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "descripcionModulo" TEXT`);
    await client.query(`DELETE FROM "NIVELES" WHERE "curso" = $1`, [curso]);
    for (let i = 0; i < norm.length; i++) {
      const r = norm[i];
      const id = `niv_${curso}_${String(i).padStart(4, '0')}`;
      await client.query(
        `INSERT INTO "NIVELES" ("_id","curso","code","step","description","descripcionModulo",
           "orden","esParalelo","origen","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,'POSTGRES',NOW(),NOW())`,
        [id, curso, r.modulo, r.leccion, r.descLec, r.descMod, r.orden]
      );
    }
  });
  // Índice único natural (una lección por curso+módulo). Best-effort.
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_niveles_curso_code_step ON "NIVELES" ("curso","code","step")`, []
  ).catch(() => {});

  return successResponse({ applied: true, curso, total: norm.length, porModulo, reemplazadas: existentes });
});
