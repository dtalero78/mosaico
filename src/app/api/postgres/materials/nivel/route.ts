import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';

/**
 * GET /api/postgres/materials/nivel?step=Step 7[&nivel=BN1][&tipo=usuario|advisor|all]
 *
 * Returns material for a given step from NIVELES table.
 * - tipo=usuario  → only materialUsuario (books for students)  [proxied through server]
 * - tipo=advisor  → only material field (advisor guides)        [direct URLs]
 * - tipo=all      → both combined (default / legacy behaviour)
 *
 * Providing ?nivel=BN1 narrows the query to that exact nivel code,
 * which avoids returning Step 3 of BN2 when BN1-Step 3 is meant.
 *
 * ── Resolución en CASCADA (agosto 2026) ────────────────────────────────────
 * El módulo que trae el evento del calendario y el que tiene el currículo se
 * desfasaron: el generador reparte las lecciones por rango, pero en NIVELES los
 * Entrenamientos y Evaluaciones son módulos aparte intercalados. Medido: 1.293
 * eventos pedían p.ej. KODOMO "Modulo 02 / Leccion 11" cuando esa lección vive
 * en "Entrenamiento 01" — y el guía veía la pestaña vacía con el material ahí.
 *
 * Por eso se busca en tres pasos, del más preciso al más útil:
 *   1. curso + módulo + lección  (exacto, como siempre)
 *   2. curso + lección           — el módulo del evento se ignora. La lección
 *      identifica el contenido y es ÚNICA dentro de cada curso (371 lecciones
 *      en 7 cursos). Si aun así resolviera a más de un módulo (pasa en WELCOME)
 *      NO se adivina.
 *   3. curso + módulo, sin lección — para las sesiones de **Evaluación**, que
 *      no son una lección del currículo (1.961 eventos): se devuelve el
 *      material del módulo completo, que es lo que el guía necesita a mano.
 *
 * La comparación ignora acentos: NIVELES escribe "Leccion 17" y los eventos a
 * veces "Lección 17". Hoy no hay ningún caso que dependa de eso, pero tampoco
 * hay dos lecciones de un curso que se distingan sólo por la tilde, así que es
 * gratis y evita que un dato nuevo rompa la pantalla.
 *
 * `origen` dice de dónde salió, para que la pestaña pueda avisarlo.
 */
const SIN_ACENTO = (col: string) => `TRANSLATE(LOWER(TRIM(${col})), 'áéíóúü', 'aeiouu')`;
const COLS = `"_id", "code", "step", "material", "materialUsuario",
              "description", "clubs", "steps", "esParalelo", "_createdDate", "_updatedDate"`;

export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const stepParam  = searchParams.get('step');
  const nivelParam = searchParams.get('nivel');   // optional — code/módulo
  const cursoParam = searchParams.get('curso');   // optional — en MOSAICO el code (módulo) se repite entre cursos
  const tipo       = searchParams.get('tipo') || 'all';

  if (!stepParam) throw new ValidationError('step query parameter is required');

  // Normalize step format ("Step1" -> "Step 1")
  const normalizedStep = stepParam.includes(' ')
    ? stepParam
    : stepParam.replace(/^Step(\d+)$/, 'Step $1');

  // ── Paso 1: exacto (curso + módulo + lección) ──
  const conds: string[] = [`(${SIN_ACENTO('"step"')} = ${SIN_ACENTO('$1')} OR ${SIN_ACENTO('"step"')} = ${SIN_ACENTO('$2')})`];
  const params: any[] = [stepParam, normalizedStep];
  if (nivelParam) { params.push(nivelParam); conds.push(`"code" = $${params.length}`); }
  if (cursoParam) { params.push(cursoParam); conds.push(`"curso" = $${params.length}`); }
  let row: any = await queryOne(`SELECT ${COLS} FROM "NIVELES" WHERE ${conds.join(' AND ')} LIMIT 1`, params);
  let origen: 'leccion' | 'otro-modulo' | 'modulo' = 'leccion';
  let moduloReal: string | null = null;

  // ── Paso 2: la misma lección, en el módulo que sea (sólo si el evento trae curso) ──
  if (!row && cursoParam && nivelParam) {
    const cand = await queryMany<any>(
      `SELECT ${COLS} FROM "NIVELES"
        WHERE "curso" = $3
          AND (${SIN_ACENTO('"step"')} = ${SIN_ACENTO('$1')} OR ${SIN_ACENTO('"step"')} = ${SIN_ACENTO('$2')})`,
      [stepParam, normalizedStep, cursoParam]
    );
    // Con más de un módulo candidato no se adivina: se pasa al paso 3.
    if (cand.length === 1) { row = cand[0]; origen = 'otro-modulo'; moduloReal = cand[0].code; }
  }

  // ── Paso 3: el módulo completo (caso "Evaluación", que no es una lección) ──
  let materialesModulo: any[] = [];
  if (!row && cursoParam && nivelParam) {
    const delModulo = await queryMany<any>(
      `SELECT ${COLS} FROM "NIVELES" WHERE "curso" = $1 AND "code" = $2 ORDER BY "orden", "step"`,
      [cursoParam, nivelParam]
    );
    if (delModulo.length) { materialesModulo = delModulo; row = delModulo[0]; origen = 'modulo'; }
  }

  if (!row) {
    return successResponse({ materials: [], material: null, origen: null, message: `No material found for ${stepParam}` });
  }

  // En modo "módulo" se juntan los materiales de TODAS sus lecciones.
  if (origen === 'modulo') {
    const junta = (campo: 'material' | 'materialUsuario') =>
      materialesModulo.flatMap((r: any) => {
        let v = r[campo];
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = []; } }
        return Array.isArray(v) ? v.map((m: any) => ({ ...m, _leccion: r.step })) : [];
      });
    row = { ...row, material: junta('material'), materialUsuario: junta('materialUsuario') };
  }

  // Parse material JSONB (legacy format: [{name, url}, ...])
  let parsedMaterial = row.material;
  if (typeof parsedMaterial === 'string') {
    try { parsedMaterial = JSON.parse(parsedMaterial); } catch { parsedMaterial = []; }
  }

  // Build materials arrays
  const userMaterials: { index: number; name: string; url: string; key?: string }[] = [];
  const advisorMaterials: { index: number; name: string; url: string; key?: string }[] = [];
  const seenUser    = new Set<string>();
  const seenAdvisor = new Set<string>();

  // 1. materialUsuario: DO Spaces keys like "materials/Filename.pdf"
  const userMats = row.materialUsuario || [];
  if (Array.isArray(userMats)) {
    for (const spacesKey of userMats) {
      if (typeof spacesKey === 'string' && spacesKey.startsWith('materials/') && !seenUser.has(spacesKey)) {
        seenUser.add(spacesKey);
        const filename = decodeURIComponent(spacesKey.split('/').pop() || spacesKey);
        userMaterials.push({
          index: userMaterials.length + 1,
          name: filename.replace(/\.pdf$/i, ''),
          url: `/api/postgres/niveles/material?key=${encodeURIComponent(spacesKey)}`,
          key: spacesKey,
        });
      }
    }
  }

  // 2. material: JSONB [{name, url}, ...] or DO Spaces keys
  if (Array.isArray(parsedMaterial)) {
    for (const m of parsedMaterial) {
      const url  = typeof m === 'string' ? m : (m?.url || '')
      const name = typeof m === 'string'
        ? decodeURIComponent(url.split('/').pop() || url).replace(/\.pdf$/i, '')
        : (m?.name || m?.nombre || `Material ${advisorMaterials.length + 1}`)
      if (url && !seenAdvisor.has(url)) {
        seenAdvisor.add(url);
        // If the url is a Spaces key (starts with materials/), expose it for presigned URL
        const spacesKey = url.startsWith('materials/') ? url : undefined;
        advisorMaterials.push({
          index: advisorMaterials.length + 1,
          name,
          url,
          key: spacesKey,
        });
      }
    }
  }

  // Build response depending on tipo
  let materials: { index: number; name: string; url: string; key?: string }[];
  if (tipo === 'usuario') {
    materials = userMaterials;
  } else if (tipo === 'advisor') {
    materials = advisorMaterials;
  } else {
    // all: combine (legacy behaviour — re-index)
    const combined = [...userMaterials, ...advisorMaterials];
    materials = combined.map((m, i) => ({ ...m, index: i + 1 }));
  }

  return successResponse({
    materials,
    nivel: row.code,
    step: row.step,
    material: row.material,
    description: row.description,
    clubs: row.clubs,
    esParalelo: row.esParalelo,
    // De dónde salió el material, para que la pantalla lo pueda explicar:
    //   'leccion'     → la lección pedida (caso normal)
    //   'otro-modulo' → la misma lección, que en el currículo vive en `moduloReal`
    //   'modulo'      → el módulo completo (la lección pedida no existe: evaluaciones)
    origen,
    moduloReal,
    leccionPedida: stepParam,
  });
});
