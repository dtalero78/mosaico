import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { getPresignedVideoUrl, spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { generateId } from '@/lib/id-generator';
import { ValidationError } from '@/lib/errors';

interface LeccionRow {
  code: string;
  step: string;
  description: string | null;
  videoUrl: string | null;
  video: string | null;
  orden: number | null;
}

/**
 * GET /api/postgres/cursos-videos?curso=YOJI&code=Modulo01
 *
 * Lista las lecciones (steps) de un módulo de un curso con su video: `videoUrl`
 * (MP4 en Spaces, + presigned preview) y `video` (enlace externo). Scopeado por
 * curso+code porque en MOSAICO el code se repite entre cursos.
 * Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const { searchParams } = new URL(request.url);
  const curso = searchParams.get('curso');
  const code = searchParams.get('code');
  if (!curso || !code) throw new ValidationError('curso y code son requeridos');

  const r = await query<LeccionRow>(
    `SELECT "code","step","description","videoUrl","video","orden"
     FROM "NIVELES" WHERE "curso" = $1 AND "code" = $2
     ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
    [curso, code]
  );

  const lecciones = await Promise.all(r.rows.map(async (x) => ({
    code: x.code,
    step: x.step,
    description: x.description,
    videoUrl: x.videoUrl,
    video: x.video,
    previewUrl: x.videoUrl ? await getPresignedVideoUrl(x.videoUrl, 600).catch(() => null) : null,
  })));

  return successResponse({ curso, code, lecciones });
});

/**
 * PATCH /api/postgres/cursos-videos
 *
 * Body: { curso, code, step, videoUrl?, video? }. Actualiza los campos presentes
 * en el body (videoUrl y/o video) de la lección (curso,code,step). Pasar null
 * limpia el campo; al limpiar `videoUrl` se borra también el objeto de Spaces.
 * Deja registro en MATERIAL_AUDIT. Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const PATCH = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const body = await request.json();
  const { curso, code, step } = body;
  if (!curso || !code || !step) throw new ValidationError('curso, code y step son requeridos');

  const hasVideoUrl = Object.prototype.hasOwnProperty.call(body, 'videoUrl');
  const hasVideo = Object.prototype.hasOwnProperty.call(body, 'video');
  if (!hasVideoUrl && !hasVideo) throw new ValidationError('nada que actualizar');

  const prev = (await query<{ videoUrl: string | null }>(
    `SELECT "videoUrl" FROM "NIVELES" WHERE "curso"=$1 AND "code"=$2 AND "step"=$3 LIMIT 1`,
    [curso, code, step]
  )).rows[0];
  if (!prev) throw new ValidationError('Lección no encontrada');

  const sets: string[] = [];
  const params: any[] = [curso, code, step];
  let i = 4;
  let accion = 'ACTUALIZAR';

  if (hasVideoUrl) {
    const nuevo: string | null = body.videoUrl || null;
    sets.push(`"videoUrl" = $${i++}`);
    params.push(nuevo);
    // Al limpiar el MP4, borrar el objeto de Spaces (best-effort)
    if (!nuevo && prev.videoUrl) {
      accion = 'BORRAR_MP4';
      try {
        await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: prev.videoUrl }));
      } catch { /* no bloquea */ }
    } else if (nuevo) {
      accion = 'SUBIR_MP4';
    }
  }
  if (hasVideo) {
    sets.push(`"video" = $${i++}`);
    params.push(body.video || null);
    if (!hasVideoUrl) accion = body.video ? 'LINK' : 'BORRAR_LINK';
  }

  await query(
    `UPDATE "NIVELES" SET ${sets.join(', ')} WHERE "curso"=$1 AND "code"=$2 AND "step"=$3`,
    params
  );

  // Auditoría (reusa MATERIAL_AUDIT — se crea sola si no existe)
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
     VALUES ($1,'video-curso',$2,$3,$4,$5,$6,$7,NOW())`,
    [
      generateId('mat'),
      `${curso} / ${code}`,
      step,
      accion,
      prev.videoUrl ?? null,
      hasVideoUrl ? (body.videoUrl || null) : (body.video || null),
      session.user?.email || 'desconocido',
    ]
  );

  return successResponse({ curso, code, step, accion });
});
