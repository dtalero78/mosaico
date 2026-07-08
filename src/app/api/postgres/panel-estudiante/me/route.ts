import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { queryOne, query } from '@/lib/postgres';
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

  // Guía del curso: resuelto de CURSOS_CAMPAIGN por campaña + tipoCurso + horario
  let cursoGuia: string | null = null;
  const campaign = (student as any)?.campaign as string | null;
  if (tipoCurso && campaign) {
    const g = await queryOne<{ nombreCompleto: string | null }>(
      `SELECT g."nombreCompleto"
         FROM "CURSOS_CAMPAIGN" cc
         JOIN "GUIAS" g ON g."_id" = cc."guia"
        WHERE cc."campaign" = $1 AND cc."tipoCurso" = $2 AND cc."horarioCurso" = $3
        LIMIT 1`,
      [campaign, tipoCurso, (student as any)?.horarioCurso ?? '']
    ).catch(() => null);
    cursoGuia = g?.nombreCompleto ?? null;
  }

  // Módulos: anterior / actual / próximo dentro de la secuencia del curso
  let cursoModulos: { anterior: string; actual: string; proximo: string } | null = null;
  const nivelActual = (student as any)?.nivel as string | null;
  if (tipoCurso && nivelActual) {
    const rows = await query<{ code: string }>(
      `SELECT "code" FROM "NIVELES" WHERE "curso" = $1 GROUP BY "code" ORDER BY MIN("orden") ASC NULLS LAST`,
      [tipoCurso]
    ).catch(() => null);
    const codes = rows?.rows.map((r) => r.code) ?? [];
    const idx = codes.indexOf(nivelActual);
    if (idx >= 0) {
      cursoModulos = {
        anterior: idx === 0 ? 'WELCOME' : codes[idx - 1],
        actual: nivelActual,
        proximo: idx === codes.length - 1 ? 'FIN DE CURSO' : codes[idx + 1],
      };
    }
  }

  return successResponse({
    profile: {
      ...student,
      perfilActualizado: urRow?.perfilActualizado ?? null,
      cursoImagenUrl,
      cursoProgreso,
      cursoGuia,
      cursoModulos,
    },
  });
});
