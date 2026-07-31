import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

/**
 * POST /api/postgres/niveles/importar-evaluacion
 *
 * Carga las preguntas de una evaluación (parseadas de un CSV tipo Tutor LMS en el
 * navegador) en UNA lección de NIVELES (curso+code+step), dejándola en modo MANUAL.
 * El alumno la verá/presentará por la card "Entrenamientos y Evaluaciones".
 * Idempotente por lección: REEMPLAZA sus preguntas. Gateado por
 * ACADEMICO.MATERIAL.ACTUALIZAR. Deja registro en MATERIAL_AUDIT.
 *
 * Body: { curso, code, step, preguntas:[{id,type,question,options[],correctAnswer,explanation?}], apply }
 *   apply=false → dry-run (valida + cuántas preguntas tenía la lección).
 */
interface Preg { id?: any; type?: string; question?: string; options?: any[]; correctAnswer?: any; explanation?: string }

function validarPreguntas(preguntas: Preg[]): { limpias: any[]; errores: string[] } {
  const errores: string[] = [];
  const limpias = preguntas.map((q, i) => {
    const n = i + 1;
    const type = q.type === 'true_false' ? 'true_false' : 'multiple_choice';
    const question = String(q.question ?? '').trim();
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()).filter((o) => o.length) : [];
    const correctAnswer = String(q.correctAnswer ?? '').trim();
    if (!question) errores.push(`P${n}: sin enunciado.`);
    if (type === 'true_false') {
      if (!['Verdadero', 'Falso'].includes(correctAnswer)) errores.push(`P${n}: verdadero/falso sin respuesta correcta válida.`);
    } else {
      if (options.length < 2) errores.push(`P${n}: necesita al menos 2 opciones.`);
      if (!correctAnswer || !options.includes(correctAnswer)) errores.push(`P${n}: la respuesta correcta no coincide con ninguna opción.`);
    }
    return { id: q.id ?? `q${n}`, type, question, options, correctAnswer, explanation: String(q.explanation ?? '') };
  });
  return { limpias, errores };
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const body = await request.json();
  const curso = String(body?.curso || '').trim();
  const code = String(body?.code || '').trim();
  const step = String(body?.step || '').trim();
  const apply = body?.apply === true;
  const preguntas: Preg[] = Array.isArray(body?.preguntas) ? body.preguntas : [];

  if (!curso || !code || !step) throw new ValidationError('Falta curso, módulo o lección de destino.');
  if (!preguntas.length) throw new ValidationError('No hay preguntas para importar.');

  const { limpias, errores } = validarPreguntas(preguntas);
  if (errores.length) throw new ValidationError('Revisa las preguntas:\n' + errores.join('\n'));

  // La lección destino debe existir en NIVELES.
  const dest = await query<{ preguntasManual: any }>(
    `SELECT "preguntasManual" FROM "NIVELES" WHERE "curso"=$1 AND "code"=$2 AND "step"=$3 LIMIT 1`,
    [curso, code, step]
  );
  if (!dest.rows.length) throw new NotFoundError(`No existe la lección ${curso} / ${code} / ${step} en NIVELES.`);
  let previas = 0;
  try {
    const raw = dest.rows[0].preguntasManual;
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    previas = Array.isArray(arr) ? arr.length : 0;
  } catch { previas = 0; }

  if (!apply) {
    return successResponse({ dryRun: true, curso, code, step, importar: limpias.length, previas });
  }

  await query(
    `UPDATE "NIVELES" SET "evaluacionModo"='MANUAL', "preguntasManual"=$4::jsonb
      WHERE "curso"=$1 AND "code"=$2 AND "step"=$3`,
    [curso, code, step, JSON.stringify(limpias)]
  );

  const email = (session as any)?.user?.email || 'desconocido';
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS "MATERIAL_AUDIT" (
         "_id" TEXT PRIMARY KEY, "tipo" TEXT, "nivel" TEXT NOT NULL,
         "step" TEXT NOT NULL, "accion" TEXT NOT NULL, "archivoAnterior" TEXT,
         "archivoNuevo" TEXT, "realizadoPor" TEXT, "_createdDate" TIMESTAMPTZ DEFAULT NOW() )`
    );
    await query(
      `INSERT INTO "MATERIAL_AUDIT"
         ("_id","tipo","nivel","step","accion","archivoAnterior","archivoNuevo","realizadoPor","_createdDate")
       VALUES ($1,'evaluacion',$2,$3,'EVALUACION_IMPORT',$4,$5,$6,NOW())`,
      [generateId('mat'), `${curso} / ${code}`, step, `${previas} preguntas`, `${limpias.length} preguntas`, email]
    );
  } catch { /* auditoría best-effort */ }

  return successResponse({ curso, code, step, importadas: limpias.length, previas });
});
