import 'server-only';
import { queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError } from '@/lib/errors';
import { cupoOcupadoSql, estadoContratoDisplay } from '@/lib/cupo';

/**
 * Inscritos de un curso/salón de campaña ([cursoId] = CURSOS_CAMPAIGN._id).
 *
 * Una sola definición para las dos pantallas que los listan: Académico ›
 * Campañas (badge de Cupos) y Panel Guía › Cursos asignados (globo de
 * inscritos). Se busca en PEOPLE por (campaign + tipoCurso + horarioCurso) —
 * la misma clave con la que se cuenta el cupo — y sólo los que OCUPAN cupo
 * (`lib/cupo`), así el listado coincide con el número del badge.
 */
export interface InscritoCurso {
  peopleId: string;
  academicaId: string | null;
  numeroId: string;
  nombre: string;
  salon: string | null;
  contrato: string | null;
  aprobacion: string | null;
  estadoContrato: string;
  inactivo: boolean;
}

export interface CursoInscritos {
  curso: { campaign: string; tipoCurso: string; horarioCurso: string; salon: string | null; guia: string | null };
  total: number;
  items: InscritoCurso[];
}

export async function listarInscritosCurso(cursoId: string): Promise<CursoInscritos> {
  const curso = await queryOne<{ campaign: string; tipoCurso: string; horarioCurso: string; salon: string | null; guia: string | null }>(
    `SELECT "campaign","tipoCurso","horarioCurso","salon","guia" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`,
    [cursoId]
  );
  if (!curso) throw new NotFoundError('CURSOS_CAMPAIGN', cursoId);

  const inscritos = await queryMany<any>(
    `SELECT p."_id"            AS "peopleId",
            a."_id"            AS "academicaId",
            p."numeroId",
            p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
            p."salon", p."contrato", p."aprobacion", p."estadoInactivo",
            t."aprobacion"     AS "aprobTitular"
       FROM "PEOPLE" p
       LEFT JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId" AND a."tipoUsuario" = 'BENEFICIARIO'
       LEFT JOIN LATERAL (
         SELECT "aprobacion" FROM "PEOPLE" pt
          WHERE pt."contrato" = p."contrato" AND pt."tipoUsuario" = 'TITULAR' LIMIT 1
       ) t ON true
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3 AND p."salon" IS NOT DISTINCT FROM $4
        AND ${cupoOcupadoSql('p')}
      ORDER BY p."primerApellido" NULLS LAST, p."primerNombre" NULLS LAST`,
    [curso.campaign, curso.tipoCurso, curso.horarioCurso, curso.salon]
  );

  const items: InscritoCurso[] = inscritos.map((r) => ({
    peopleId: r.peopleId,
    academicaId: r.academicaId ?? null,
    numeroId: r.numeroId ?? '—',
    nombre: [r.primerNombre, r.segundoNombre, r.primerApellido, r.segundoApellido].filter(Boolean).join(' ') || '—',
    salon: r.salon ?? null,
    contrato: r.contrato ?? null,
    aprobacion: r.aprobacion ?? null,
    // Estado del CONTRATO (Pendiente/Aprobado/Devuelto): los liberadores ya no se listan.
    estadoContrato: estadoContratoDisplay(r.aprobTitular ?? null, r.aprobacion ?? null),
    inactivo: r.estadoInactivo === true,
  }));

  return { curso, total: items.length, items };
}
