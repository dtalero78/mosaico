/**
 * GET /api/postgres/events/alumnos-salon?campaign=&curso=&salon=
 *
 * Los alumnos de un salón, para agendarlos de una vez al crear una RECUPERACIÓN:
 * al guardarla se ofrecen todos marcados y quien la crea decide a quién deja
 * fuera (el que sí asistió, el que está en hold).
 *
 * Existe aparte de `campaigns/[id]/inscritos` —que devuelve lo mismo— por dos
 * razones: aquél se pide por el `_id` del curso de campaña, que el modal de
 * evento no maneja (trabaja con campaña + curso + salón), y va gateado por el
 * permiso de CREAR CAMPAÑAS, que quien agenda un evento no tiene por qué tener.
 *
 * Devuelve SÓLO a los que ocupan cupo (`cupoOcupadoSql`), que es la misma regla
 * con la que el sistema cuenta los cupos del salón: deja fuera contratos
 * anulados/retractados y a los que están en hold — gente que hoy no está
 * cursando y a la que no corresponde agendarle una reposición.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { queryMany } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.NUEVO_EVENTO);

  const { searchParams } = new URL(request.url);
  const campaign = (searchParams.get('campaign') || '').trim();
  const curso = (searchParams.get('curso') || '').trim();
  const salon = (searchParams.get('salon') || '').trim();

  // El modal admite 'Todos' como comodín de curso/salón; ahí no hay un salón
  // concreto del que sacar la lista, así que se pide que lo concrete.
  const comodin = (v: string) => !v || /^todos$/i.test(v) || /^todas$/i.test(v);
  if (!campaign || comodin(curso) || comodin(salon)) {
    throw new ValidationError(
      'Para agendar al salón hay que elegir una campaña, un curso y un salón concretos (no "Todos").'
    );
  }

  const rows = await queryMany<any>(
    `SELECT a."_id" AS "academicaId", p."numeroId", p."salon",
            p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"
       FROM "PEOPLE" p
       JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId" AND a."tipoUsuario" = 'BENEFICIARIO'
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."salon" = $3
        AND ${cupoOcupadoSql('p')}
      ORDER BY UPPER(p."primerApellido") NULLS LAST, UPPER(p."primerNombre") NULLS LAST`,
    [campaign, curso, salon]
  );

  const items = rows.map((r) => ({
    academicaId: r.academicaId,
    numeroId: r.numeroId ?? '—',
    nombre: [r.primerNombre, r.segundoNombre, r.primerApellido, r.segundoApellido]
      .filter(Boolean).join(' ') || '—',
  }));

  return successResponse({ total: items.length, items });
});
