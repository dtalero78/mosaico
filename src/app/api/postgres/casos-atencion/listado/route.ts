import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission, Role } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { ESTADO_ABIERTO } from '@/services/casos-atencion.service';

/**
 * GET /api/postgres/casos-atencion/listado — Académico › Casos Usuarios.
 *
 * Filtros: estado, tema, curso, salón, búsqueda por alumno/código/contrato.
 *
 * ⚠ El rol GUIA sólo ve los casos que ÉL reportó (R12). Se resuelve en el
 * SERVIDOR con el email de la sesión, no con un parámetro: si dependiera del
 * front, cualquiera podría pedir los de otro guía.
 */
const MAX_ROWS = 500;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CASOS_USUARIOS_VER);

  const sp = new URL(request.url).searchParams;
  const estado = (sp.get('estado') || '').trim();
  const tema = (sp.get('tema') || '').trim();
  const curso = (sp.get('curso') || '').trim();
  const salon = (sp.get('salon') || '').trim();
  const guiaFiltro = (sp.get('guia') || '').trim();   // GUIAS._id
  const q = (sp.get('q') || '').trim();

  const where: string[] = ['1=1'];
  const params: any[] = [];
  let i = 1;

  // Alcance del guía: sólo sus reportes.
  const u = (session as any)?.user || {};
  const esGuia = String(u.role || '') === Role.ADVISOR;
  if (esGuia) {
    where.push(`EXISTS (SELECT 1 FROM "CASOS_REPORTES" rr
                         WHERE rr."casoId" = c."_id"
                           AND (LOWER(TRIM(rr."guiaId")) = LOWER(TRIM($${i}))
                             OR LOWER(TRIM(rr."guiaNombre")) = LOWER(TRIM($${i + 1}))))`);
    params.push(u.id || '', u.name || u.email || '');
    i += 2;
  }

  if (estado === 'abiertos') where.push(`c."estado" = '${ESTADO_ABIERTO}'`);
  else if (estado === 'cerrados') where.push(`c."estado" <> '${ESTADO_ABIERTO}'`);
  else if (estado) { where.push(`c."estado" = $${i++}::estado_caso`); params.push(estado); }

  if (tema) { where.push(`c."tema" = $${i++}::tema_caso`); params.push(tema); }
  if (curso) { where.push(`p."tipoCurso" = $${i++}`); params.push(curso); }
  if (salon) { where.push(`p."salon" = $${i++}`); params.push(salon); }
  // El guía es el del CURSO del alumno (CURSOS_CAMPAIGN), no el que reportó:
  // es el mismo criterio con el que se muestra en la columna Guía.
  if (guiaFiltro) { where.push(`cc."guia" = $${i++}`); params.push(guiaFiltro); }
  if (q) {
    where.push(`(c."codigo" ILIKE $${i} OR c."contrato" ILIKE $${i}
                 OR CONCAT_WS(' ', p."primerNombre", p."primerApellido") ILIKE $${i}
                 OR p."numeroId" ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }

  const { rows } = await query<any>(
    `SELECT c."_id", c."codigo", c."tema", c."estado", c."contrato", c."numeroCaso",
            c."abiertoEn", c."cerradoEn", c."reincidenciaNivel",
            c."academicaId", p."numeroId",
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."primerApellido"), '\\s+', ' ', 'g')) AS alumno,
            p."tipoCurso" AS curso, p."salon", g."nombreCompleto" AS guia,
            (SELECT COUNT(*)::int FROM "CASOS_REPORTES" r WHERE r."casoId" = c."_id") AS reportes,
            -- R7: la marca de "sin leer" debe verse en el listado, no sólo dentro.
            (SELECT COUNT(*)::int FROM "CASOS_REPORTES" r
              WHERE r."casoId" = c."_id" AND r."leido" = false) AS "sinLeer",
            (SELECT MAX(r."_createdDate") FROM "CASOS_REPORTES" r WHERE r."casoId" = c."_id") AS "ultimoReporte"
       FROM "CASOS_ATENCION" c
       JOIN "ACADEMICA" a ON a."_id" = c."academicaId"
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso"
        AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ${where.join(' AND ')}
      ORDER BY (c."estado" = '${ESTADO_ABIERTO}') DESC, "ultimoReporte" DESC NULLS LAST
      LIMIT ${MAX_ROWS}`,
    params
  );

  // Catálogos de los dropdowns, acotados a lo que el usuario puede ver: si es
  // GUIA sólo salen las opciones de SUS casos, para que no pueda elegir un
  // filtro que nunca le devolvería nada.
  const { rows: opts } = await query<any>(
    `SELECT DISTINCT p."tipoCurso" AS curso, p."salon",
            cc."guia" AS "guiaId", g."nombreCompleto" AS "guiaNombre"
       FROM "CASOS_ATENCION" c
       JOIN "ACADEMICA" a ON a."_id" = c."academicaId"
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso"
        AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ${esGuia ? where[1] : '1=1'}`,
    esGuia ? params.slice(0, 2) : []
  );

  const guias = Array.from(
    new Map(opts.filter(o => o.guiaId && o.guiaNombre)
      .map(o => [o.guiaId, { _id: o.guiaId, nombre: o.guiaNombre }])).values()
  ).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return successResponse({
    rows,
    total: rows.length,
    abiertos: rows.filter(r => r.estado === ESTADO_ABIERTO).length,
    sinLeer: rows.reduce((n, r) => n + (Number(r.sinLeer) || 0), 0),
    soloMisCasos: esGuia,
    cursos: Array.from(new Set(opts.map(o => o.curso).filter(Boolean))).sort(),
    salones: Array.from(new Set(opts.map(o => o.salon).filter(Boolean))).sort(),
    guias,
  });
});
