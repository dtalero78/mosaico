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
  actividadKahoot: string | null;
  actividadWordwall: string | null;
  actividadKahootNombre: string | null;
  actividadWordwallNombre: string | null;
  descripcionModulo: string | null;
  recursos: any;
  orden: number | null;
  evaluacionModo: string | null;
  preguntasManual: any;
  evaluacionMinutos: number | null;
}

function parseRecursos(raw: any): { nombre: string; link: string }[] {
  const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
  return (Array.isArray(arr) ? arr : [])
    .map((r: any) => ({ nombre: String(r?.nombre || '').trim(), link: String(r?.link || '').trim() }))
    .filter((r) => r.nombre || r.link);
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
    `SELECT "step","description","contenido","actividadKahoot","actividadWordwall",
            "actividadKahootNombre","actividadWordwallNombre","descripcionModulo","recursos",
            "orden","evaluacionModo","preguntasManual","evaluacionMinutos"
     FROM "NIVELES" WHERE "curso" = $1 AND "code" = $2
     ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
    [curso, code]
  );

  return successResponse({
    curso,
    code,
    descripcionModulo: r.rows[0]?.descripcionModulo ?? '',
    // Recursos son a nivel MÓDULO (uniformes en todas las lecciones); tomo el 1º con datos.
    recursos: parseRecursos(r.rows.find((x) => parseRecursos(x.recursos).length)?.recursos ?? r.rows[0]?.recursos),
    lecciones: r.rows.map((x) => ({
      step: x.step,
      description: x.description ?? '',
      contenido: x.contenido ?? '',
      actividadKahoot: x.actividadKahoot ?? '',
      actividadWordwall: x.actividadWordwall ?? '',
      actividadKahootNombre: x.actividadKahootNombre ?? '',
      actividadWordwallNombre: x.actividadWordwallNombre ?? '',
      evaluacionModo: (x.evaluacionModo || 'IA').toUpperCase(),
      preguntasManual: parsePreguntas(x.preguntasManual),
      evaluacionMinutos: Number(x.evaluacionMinutos) > 0 ? Number(x.evaluacionMinutos) : 30,
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
    // Modo módulo: descripcionModulo y/o recursos → a TODAS las lecciones del módulo.
    const hasDescMod = Object.prototype.hasOwnProperty.call(body, 'descripcionModulo');
    const hasRecursos = Object.prototype.hasOwnProperty.call(body, 'recursos');
    if (!hasDescMod && !hasRecursos) {
      throw new ValidationError('descripcionModulo o recursos requerido en modo módulo');
    }
    const sets: string[] = [];
    const params: any[] = [curso, code];
    let i = 3;
    if (hasDescMod) { sets.push(`"descripcionModulo" = $${i++}`); params.push(body.descripcionModulo || null); }
    if (hasRecursos) { sets.push(`"recursos" = $${i++}::jsonb`); params.push(JSON.stringify(parseRecursos(body.recursos))); }
    sets.push(`"_updatedDate" = NOW()`);
    await query(
      `UPDATE "NIVELES" SET ${sets.join(', ')} WHERE "curso" = $1 AND "code" = $2`,
      params
    );
    accion = hasRecursos ? (hasDescMod ? 'MODULO' : 'RECURSOS_MODULO') : 'DESCRIPCION_MODULO';
  } else {
    // Modo lección: description, contenido, evaluacionModo y/o preguntasManual
    const hasDesc = Object.prototype.hasOwnProperty.call(body, 'description');
    const hasCont = Object.prototype.hasOwnProperty.call(body, 'contenido');
    const hasKahoot = Object.prototype.hasOwnProperty.call(body, 'actividadKahoot');
    const hasWordwall = Object.prototype.hasOwnProperty.call(body, 'actividadWordwall');
    const hasKahootN = Object.prototype.hasOwnProperty.call(body, 'actividadKahootNombre');
    const hasWordwallN = Object.prototype.hasOwnProperty.call(body, 'actividadWordwallNombre');
    const hasModo = Object.prototype.hasOwnProperty.call(body, 'evaluacionModo');
    const hasPreg = Object.prototype.hasOwnProperty.call(body, 'preguntasManual');
    const hasMin = Object.prototype.hasOwnProperty.call(body, 'evaluacionMinutos');
    if (!hasDesc && !hasCont && !hasKahoot && !hasWordwall && !hasKahootN && !hasWordwallN && !hasModo && !hasPreg && !hasMin) throw new ValidationError('nada que actualizar');

    const sets: string[] = [];
    const params: any[] = [curso, code, step];
    let i = 4;
    if (hasDesc) { sets.push(`"description" = $${i++}`); params.push(body.description ?? ''); }
    if (hasCont) { sets.push(`"contenido" = $${i++}`); params.push(body.contenido ?? ''); }
    if (hasKahoot) { sets.push(`"actividadKahoot" = $${i++}`); params.push(body.actividadKahoot || null); }
    if (hasWordwall) { sets.push(`"actividadWordwall" = $${i++}`); params.push(body.actividadWordwall || null); }
    if (hasKahootN) { sets.push(`"actividadKahootNombre" = $${i++}`); params.push(body.actividadKahootNombre || null); }
    if (hasWordwallN) { sets.push(`"actividadWordwallNombre" = $${i++}`); params.push(body.actividadWordwallNombre || null); }
    if (hasModo) {
      const modo = String(body.evaluacionModo || 'IA').toUpperCase();
      if (modo !== 'IA' && modo !== 'MANUAL') throw new ValidationError('evaluacionModo inválido (IA | MANUAL)');
      sets.push(`"evaluacionModo" = $${i++}`); params.push(modo);
    }
    if (hasPreg) {
      const preg = Array.isArray(body.preguntasManual) ? body.preguntasManual : [];
      sets.push(`"preguntasManual" = $${i++}::jsonb`); params.push(JSON.stringify(preg));
    }
    if (hasMin) {
      const min = Math.round(Number(body.evaluacionMinutos));
      if (!Number.isFinite(min) || min < 1 || min > 180) throw new ValidationError('evaluacionMinutos inválido (1–180)');
      sets.push(`"evaluacionMinutos" = $${i++}`); params.push(min);
    }
    sets.push(`"_updatedDate" = NOW()`);

    const res = await query(
      `UPDATE "NIVELES" SET ${sets.join(', ')} WHERE "curso"=$1 AND "code"=$2 AND "step"=$3`,
      params
    );
    if (res.rowCount === 0) throw new ValidationError('Lección no encontrada');
    accion = (hasModo || hasPreg || hasMin) ? 'EVALUACION' : hasCont ? 'CONTENIDO' : 'DESCRIPCION';
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
