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
  clubs?: any;
  contenido?: string;
  esParalelo?: any;
}

function toBool(v: any): boolean {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'verdadero' || s === 'true' || s === 't' || s === '1' || s === 'si' || s === 'sí';
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
    const clubs = Array.isArray(r.clubs)
      ? r.clubs.map((c: any) => String(c ?? '')).filter((c: string) => c.length > 0)
      : [];
    return {
      modulo,
      descMod: String(r.descripcionModulo || '').trim(),
      leccion,
      descLec: String(r.descripcion || '').trim(),
      orden,
      clubs,
      contenido: typeof r.contenido === 'string' ? r.contenido : '',
      esParalelo: toBool(r.esParalelo),
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
  const conClubs = norm.filter(r => r.clubs.length > 0).length;
  const conContenido = norm.filter(r => r.contenido.trim().length > 0).length;

  // Cuántas filas tiene hoy el curso (para avisar que se reemplazará)
  const actual = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "NIVELES" WHERE "curso" = $1`, [curso]
  );
  const existentes = actual.rows[0]?.n ?? 0;

  if (!apply) {
    return successResponse({
      preview: true, curso, total: norm.length, porModulo, existentes, conClubs, conContenido,
      inicio: { code: norm[0].modulo, step: norm[0].leccion, orden: norm[0].orden },
    });
  }

  await withTransaction(async (client) => {
    // Columnas que el INSERT necesita (idempotente en BDs sin la migración completa).
    await client.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "descripcionModulo" TEXT`);
    await client.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "contenido" TEXT`);
    await client.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "clubs" JSONB DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "evaluacionModo" VARCHAR(10) DEFAULT 'IA'`);
    await client.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "preguntasManual" JSONB DEFAULT '[]'::jsonb`);

    // Preserva los campos de evaluación (Fase 3) que el export no trae, por (code, step).
    const prev = await client.query(
      `SELECT "code","step","evaluacionModo","preguntasManual" FROM "NIVELES" WHERE "curso" = $1`,
      [curso]
    );
    const prevMap = new Map(
      (prev.rows as any[]).map(r => [`${r.code}||${r.step}`, r])
    );

    await client.query(`DELETE FROM "NIVELES" WHERE "curso" = $1`, [curso]);
    for (let i = 0; i < norm.length; i++) {
      const r = norm[i];
      const id = `niv_${curso}_${String(i).padStart(4, '0')}`;
      const p = prevMap.get(`${r.modulo}||${r.leccion}`);
      const evalModo = (p?.evaluacionModo || 'IA');
      const pregRaw = p?.preguntasManual;
      const preg = pregRaw == null ? '[]' : (typeof pregRaw === 'string' ? pregRaw : JSON.stringify(pregRaw));
      await client.query(
        `INSERT INTO "NIVELES" ("_id","curso","code","step","description","descripcionModulo",
           "orden","esParalelo","clubs","contenido","evaluacionModo","preguntasManual","origen","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,'POSTGRES',NOW(),NOW())`,
        [id, curso, r.modulo, r.leccion, r.descLec, r.descMod, r.orden, r.esParalelo,
         JSON.stringify(r.clubs), r.contenido, evalModo, preg]
      );
    }
  });
  // Índice único natural (una lección por curso+módulo). Best-effort.
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_niveles_curso_code_step ON "NIVELES" ("curso","code","step")`, []
  ).catch(() => {});

  return successResponse({ applied: true, curso, total: norm.length, porModulo, reemplazadas: existentes, conClubs, conContenido });
});
