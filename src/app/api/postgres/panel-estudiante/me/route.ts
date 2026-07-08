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

  return successResponse({
    profile: {
      ...student,
      perfilActualizado: urRow?.perfilActualizado ?? null,
      cursoImagenUrl,
    },
  });
});
