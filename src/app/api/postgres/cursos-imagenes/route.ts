import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { getPresignedVideoUrl } from '@/lib/spaces';

/**
 * GET /api/postgres/cursos-imagenes
 *
 * Lista los tipos de curso con su imagen (key en DO Spaces, carpeta Cursos/) y
 * una URL presigned (10 min) para preview. Alimenta la tarjeta "Imágenes de
 * curso" de Mantenimiento Cursos. Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const r = await query<{ tipoCurso: string; imagen: string | null }>(
    `SELECT "tipoCurso", "imagen" FROM "CURSOS_IMAGENES"
     ORDER BY CASE "tipoCurso"
       WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
       WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END`
  );

  const cursos = await Promise.all(r.rows.map(async (x) => ({
    tipoCurso: x.tipoCurso,
    imagen: x.imagen,
    url: x.imagen ? await getPresignedVideoUrl(x.imagen, 600).catch(() => null) : null,
  })));

  return successResponse({ cursos });
});
