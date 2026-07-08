import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { queryOne } from '@/lib/postgres';
import { getPresignedVideoUrl } from '@/lib/spaces';

export const GET = handlerWithAuth(async (request, context, session) => {
  const student = await resolveStudentFromSession(session);

  // Fetch perfilActualizado from USUARIOS_ROLES to drive the "Actualizar" button in Perfil modal
  const email = session.user?.email;
  const urRow = email
    ? await queryOne<{ perfilActualizado: string | null }>(
        `SELECT "perfilActualizado" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
        [email]
      ).catch(() => null)
    : null;

  // Imagen del curso (MOSAICO): tipoCurso del estudiante → CURSOS_IMAGENES → URL firmada
  const tipoCurso = (student as any)?.tipoCurso as string | null;
  let cursoImagenUrl: string | null = null;
  if (tipoCurso) {
    const img = await queryOne<{ imagen: string | null }>(
      `SELECT "imagen" FROM "CURSOS_IMAGENES" WHERE "tipoCurso" = $1 LIMIT 1`,
      [tipoCurso]
    ).catch(() => null);
    if (img?.imagen) {
      cursoImagenUrl = await getPresignedVideoUrl(img.imagen, 3600).catch(() => null);
    }
  }

  // Progreso del curso: total de lecciones del curso + posición de la lección actual
  let cursoProgreso: { total: number; actual: number } | null = null;
  if (tipoCurso) {
    // Match por `step` (nombre de lección): la numeración de lecciones es global
    // en el curso y no reinicia por módulo, así que el step es la posición real.
    const prog = await queryOne<{ total: number; actual: number | null }>(
      `WITH ord AS (
         SELECT "step",
                ROW_NUMBER() OVER (ORDER BY "orden" ASC NULLS LAST, "step" ASC) AS pos
         FROM "NIVELES" WHERE "curso" = $1
       )
       SELECT
         (SELECT COUNT(*)::int FROM "NIVELES" WHERE "curso" = $1) AS total,
         (SELECT MIN(pos)::int FROM ord WHERE "step" = $2) AS actual`,
      [tipoCurso, (student as any)?.step ?? '']
    ).catch(() => null);
    if (prog?.total) cursoProgreso = { total: prog.total, actual: prog.actual ?? 0 };
  }

  return successResponse({
    profile: {
      ...student,
      perfilActualizado: urRow?.perfilActualizado ?? null,
      cursoImagenUrl,
      cursoProgreso,
    },
  });
});
