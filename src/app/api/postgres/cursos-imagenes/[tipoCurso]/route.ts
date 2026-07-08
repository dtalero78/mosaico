import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { query, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { ValidationError } from '@/lib/errors';
import { TIPOS_CURSO } from '@/lib/cursos-campaign';

/**
 * PATCH /api/postgres/cursos-imagenes/[tipoCurso]
 *
 * Guarda la key de imagen (ya subida via presign) en CURSOS_IMAGENES y deja
 * registro en MATERIAL_AUDIT. Body: { imagen: key | null }.
 * Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const PATCH = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const tipoCurso = (params?.tipoCurso as string) || '';
  if (!(TIPOS_CURSO as readonly string[]).includes(tipoCurso)) {
    throw new ValidationError(`tipoCurso inválido: ${tipoCurso}`);
  }

  const { imagen } = await request.json();
  const nuevaKey: string | null = imagen || null;

  const prev = await queryOne<{ imagen: string | null }>(
    `SELECT "imagen" FROM "CURSOS_IMAGENES" WHERE "tipoCurso" = $1`,
    [tipoCurso]
  );

  await query(
    `INSERT INTO "CURSOS_IMAGENES" ("_id","tipoCurso","imagen","_createdDate","_updatedDate")
     VALUES ($1,$2,$3,NOW(),NOW())
     ON CONFLICT ("tipoCurso") DO UPDATE SET "imagen" = EXCLUDED."imagen", "_updatedDate" = NOW()`,
    [generateId('cimg'), tipoCurso, nuevaKey]
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
     VALUES ($1,'imagen-curso',$2,'-',$3,$4,$5,$6,NOW())`,
    [
      generateId('mat'),
      tipoCurso,
      nuevaKey ? 'ACTUALIZAR' : 'BORRAR',
      prev?.imagen ?? null,
      nuevaKey,
      session.user?.email || 'desconocido',
    ]
  );

  return successResponse({ tipoCurso, imagen: nuevaKey });
});
