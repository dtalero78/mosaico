import 'server-only';
import { queryOne } from '@/lib/postgres';
import { lunesDeSemanaChile } from '@/lib/reporte-academico-ventana';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { getReporteAcademico, puedeEnviarseAlApoderado, type EstadoCierre } from '@/services/reporte-academico.service';
import { buildReporteIndividualHtml } from '@/lib/reporte-academico-pdf';

/**
 * Reporte académico DEL PROPIO ESTUDIANTE (panel del estudiante › Reportes).
 *
 * Reusa el reporte semanal del Guía y el mismo HTML del informe que recibe el
 * apoderado, pero:
 *   - sólo devuelve la fila del alumno de la sesión (nunca la de sus compañeros);
 *   - sólo ofrece las DOS semanas ya terminadas (la pasada y la anterior);
 *   - sólo muestra un informe CERRADO en definitivo — igual que el que se envía al
 *     apoderado: lo que ve el alumno ya no puede cambiar después.
 */

const addDias = (iso: string, n: number) =>
  new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

/** Lunes de las dos últimas semanas COMPLETAS (la más reciente primero). */
export function semanasDisponibles(now: Date = new Date()): string[] {
  const lunes = lunesDeSemanaChile(now);
  return [addDias(lunes, -7), addDias(lunes, -14)];
}

export interface ReporteEstudiante {
  semanas: { inicio: string; fin: string }[];
  semanaInicio: string;
  semanaFin: string;
  disponible: boolean;
  motivo?: string;
  html?: string;
  nombre?: string;
  /**
   * Clave del PDF: documento del titular del contrato (quien actúa de apoderado).
   * SOLO para uso del servidor: la ruta JSON la quita antes de responder.
   */
  clavePdf?: string;
}

export async function getReporteDelEstudiante(session: any, semanaPedida?: string): Promise<ReporteEstudiante> {
  const student: any = await resolveStudentFromSession(session);
  const lunes = semanasDisponibles();
  const semanas = lunes.map(l => ({ inicio: l, fin: addDias(l, 6) }));
  const semanaInicio = lunes.includes(String(semanaPedida || '')) ? String(semanaPedida) : lunes[0];
  const semanaFin = addDias(semanaInicio, 6);
  const base = { semanas, semanaInicio, semanaFin };

  const academicaId = student.academicaId || student._id;
  const curso = await queryOne<{ tipoCurso: string | null; salon: string | null; campaign: string | null; clavePdf: string | null }>(
    `SELECT p."tipoCurso", p."salon", p."campaign",
            (SELECT t."numeroId" FROM "PEOPLE" t
              WHERE t."contrato" = p."contrato" AND t."tipoUsuario" = 'TITULAR' LIMIT 1) AS "clavePdf"
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
      WHERE a."_id" = $1 LIMIT 1`,
    [academicaId]
  );
  if (!curso?.tipoCurso || !curso.salon || !curso.campaign || curso.tipoCurso.toUpperCase() === 'IMPULSA') {
    return { ...base, disponible: false, motivo: 'El reporte académico no está disponible para tu curso.' };
  }

  // `session` es la del estudiante (no GUIA): el servicio no le aplica alcance de
  // guía, y de ahí sólo se toma SU fila.
  const data: any = await getReporteAcademico({
    curso: curso.tipoCurso, salon: curso.salon, campaign: curso.campaign, startDate: semanaInicio,
  }, session);

  const row = (data.rows || []).find((r: any) => r.academicaId === academicaId);
  if (!row || !row.sesSemana) {
    return { ...base, disponible: false, motivo: 'No tuviste sesiones registradas en esta semana.' };
  }
  const estado = (data.cierre?.estado || 'BORRADOR') as EstadoCierre;
  if (!puedeEnviarseAlApoderado(estado)) {
    return { ...base, disponible: false, motivo: 'El reporte de esta semana aún no está disponible: tu guía lo está revisando.' };
  }

  const html = buildReporteIndividualHtml(row, {
    curso: String(data.curso || ''), salon: String(data.salon || ''), guiaNombre: String(data.guiaNombre || ''),
    semanaInicio: String(data.semanaInicio || ''), semanaFin: String(data.semanaFin || ''),
  });
  return { ...base, disponible: true, html, nombre: row.nombre, clavePdf: curso.clavePdf || undefined };
}
