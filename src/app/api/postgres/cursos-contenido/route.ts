import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { ValidationError } from '@/lib/errors';

interface Row {
  step: string;
  description: string | null;
  contenido: string | null;
  descripcionModulo: string | null;
  orden: number | null;
  evaluacionModo: string | null;
  preguntasManual: any;
}

function parsePreguntas(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

/**
 * GET /api/postgres/cursos-contenido?curso=YOJI&code=Modulo01
 *
 * Devuelve la descripción del módulo y las lecciones (step) con su descripción y
 * contenido (temario, fuente del quiz IA). Scopeado por curso+code (en MOSAICO el
 * code se repite entre cursos). Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const { searchParams } = new URL(request.url);
  const curso = searchParams.get('curso');
  const code = searchParams.get('code');
  if (!curso || !code) throw new ValidationError('curso y code son requeridos');

  const r = await query<Row>(
    `SELECT "step","description","contenido","descripcionModulo","orden","evaluacionModo","preguntasManual"
     FROM "NIVELES" WHERE "curso" = $1 AND "code" = $2
     ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
    [curso, code]
  );

  return successResponse({
    curso,
    code,
    descripcionModulo: r.rows[0]?.descripcionModulo ?? '',
    lecciones: r.rows.map((x) => ({
      step: x.step,
      description: x.description ?? '',
      contenido: x.contenido ?? '',
      evaluacionModo: (x.evaluacionModo || 'IA').toUpperCase(),
      preguntasManual: parsePreguntas(x.preguntasManual),
    })),
  });
});

/**
 * PATCH /api/postgres/cursos-contenido
 *
 * Dos modos:
 *  - Módulo:  { curso, code, descripcionModulo }        → actualiza TODAS las lecciones del módulo.
 *  - Lección: { curso, code, step, description?, contenido? } → actualiza esa lección.
 * Deja registro en MATERIAL_AUDIT. Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const PATCH = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const body = await request.json();
  const { curso, code, step } = body;
  if (!curso || !code) throw new ValidationError('curso y code son requeridos');

  const email = session.user?.email || 'desconocido';
  let accion = '';
  let auditStep = step || '-';

  if (!step) {
    // Modo módulo: descripcionModulo a todas las lecciones
    if (!Object.prototype.hasOwnProperty.call(body, 'descripcionModulo')) {
      throw new ValidationError('descripcionModulo requerido en modo módulo');
    }
    await query(
      `UPDATE "NIVELES" SET "descripcionModulo" = $3, "_updatedDate" = NOW()
       WHERE "curso" = $1 AND "code" = $2`,
      [curso, code, body.descripcionModulo || null]
    );
    accion = 'DESCRIPCION_MODULO';
  } else {
    // Modo lección: description, contenido, evaluacionModo y/o preguntasManual
    const hasDesc = Object.prototype.hasOwnProperty.call(body, 'description');
    const hasCont = Object.prototype.hasOwnProperty.call(body, 'contenido');
    const hasModo = Object.prototype.hasOwnProperty.call(body, 'evaluacionModo');
    const hasPreg = Object.prototype.hasOwnProperty.call(body, 'preguntasManual');
    if (!hasDesc && !hasCont && !hasModo && !hasPreg) throw new ValidationError('nada que actualizar');

    const sets: string[] = [];
    const params: any[] = [curso, code, step];
    let i = 4;
    if (hasDesc) { sets.push(`"description" = $${i++}`); params.push(body.description ?? ''); }
    if (hasCont) { sets.push(`"contenido" = $${i++}`); params.push(body.contenido ?? ''); }
    if (hasModo) {
      const modo = String(body.evaluacionModo || 'IA').toUpperCase();
      if (modo !== 'IA' && modo !== 'MANUAL') throw new ValidationError('evaluacionModo inválido (IA | MANUAL)');
      sets.push(`"evaluacionModo" = $${i++}`); params.push(modo);
    }
    if (hasPreg) {
      const preg = Array.isArray(body.preguntasManual) ? body.preguntasManual : [];
      sets.push(`"preguntasManual" = $${i++}::jsonb`); params.push(JSON.stringify(preg));
    }
    sets.push(`"_updatedDate" = NOW()`);

    const res = await query(
      `UPDATE "NIVELES" SET ${sets.join(', ')} WHERE "curso"=$1 AND "code"=$2 AND "step"=$3`,
      params
    );
    if (res.rowCount === 0) throw new ValidationError('Lección no encontrada');
    accion = (hasModo || hasPreg) ? 'EVALUACION' : hasCont ? 'CONTENIDO' : 'DESCRIPCION';
  }

  await query(`
    CREATE TABLE IF NOT EXISTS "MATERIAL_AUDIT" (
      "_id" TEXT PRIMARY KEY, "tipo" TEXT NOT NULL, "nivel" TEXT NOT NULL,
      "step" TEXT NOT NULL, "accion" TEXT NOT NULL, "archivoAnterior" TEXT,
      "archivoNuevo" TEXT, "realizadoPor" TEXT NOT NULL,
      "_createdDate" TIMESTAMPTZ DEFAULT NOW()
    )`);
  await query(
    `INSERT INTO "MATERIAL_AUDIT"
       ("_id","tipo","nivel","step","accion","archivoAnterior","archivoNuevo","realizadoPor","_createdDate")
     VALUES ($1,'contenido-curso',$2,$3,$4,NULL,NULL,$5,NOW())`,
    [generateId('mat'), `${curso} / ${code}`, auditStep, accion, email]
  );

  return successResponse({ curso, code, step: step || null, accion });
});
