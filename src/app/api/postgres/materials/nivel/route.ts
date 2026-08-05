import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';

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
 */
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

  // Query NIVELES — filtro por step (lección) + code (módulo) + curso, según lo disponible.
  const conds: string[] = ['("step" = $1 OR "step" = $2)'];
  const params: any[] = [stepParam, normalizedStep];
  if (nivelParam) { params.push(nivelParam); conds.push(`"code" = $${params.length}`); }
  if (cursoParam) { params.push(cursoParam); conds.push(`"curso" = $${params.length}`); }
  const row = await queryOne(
    `SELECT "_id", "code", "step", "material", "materialUsuario",
            "description", "clubs", "steps", "esParalelo",
            "_createdDate", "_updatedDate"
     FROM "NIVELES"
     WHERE ${conds.join(' AND ')}
     LIMIT 1`,
    params
  );

  if (!row) {
    return successResponse({ materials: [], material: null, message: `No material found for ${stepParam}` });
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
  });
});
