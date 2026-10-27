import 'server-only';
import { queryMany, queryOne } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { previewMovimiento, ejecutarMovimiento } from './movimiento-academico.service';
import { registrarSaltoSalon } from './repetir-clase.service';

/**
 * Ajuste masivo (Académico › Mantenimiento) — el Ajuste Lecciones de la ficha
 * del alumno aplicado a todo un SALÓN.
 *
 * No hay lógica propia de lecciones: cada alumno pasa por `previewMovimiento` y
 * `ejecutarMovimiento`, los mismos del ajuste individual. Con dos copias, la
 * primera corrección de la regla las desalinearía y el ajuste masivo aprobaría
 * cosas distintas que el individual.
 *
 * Decisiones del usuario:
 *  - Por defecto sólo HACIA ADELANTE: quien ya va más adelante que la lección
 *    elegida (o en ella) queda como está. Retroceder exige marcar expresamente
 *    "permitir retroceder" y pasa por una confirmación que muestra cuántas
 *    lecciones y evaluaciones perdería cada alumno.
 *  - Los alumnos de un salón son los que OCUPAN cupo en él (lib/cupo), la misma
 *    regla con la que se cuentan los inscritos.
 *  - Motivo obligatorio; cada alumno queda con su entrada en cambioStepHistory y
 *    su comentario en PEOPLE, marcados como "Ajuste masivo".
 *  - Un alumno que falla no detiene a los demás: el resultado lo informa uno a uno.
 */

export const MAX_ALUMNOS_AJUSTE = 60;
export const ORIGEN_AJUSTE_MASIVO = 'Ajuste masivo';

export type AccionAjuste =
  | 'APLICA'          // se moverá hacia adelante
  | 'RETROCEDE'       // (sólo con "permitir retroceder") se moverá hacia atrás
  | 'MAS_ADELANTE'    // ya va más adelante: no se toca
  | 'IGUAL'           // ya está en esa lección
  | 'WELCOME'         // sigue en el puente WELCOME
  | 'NO_ENCONTRADA';  // la lección no está en su secuencia de clases

interface Curso {
  _id: string; campaign: string; tipoCurso: string; horarioCurso: string;
  salon: string | null; guia: string | null;
}

/** Cursos activos para la cascada Campaña → Curso → Salón. */
export async function listarCursos() {
  return queryMany<Curso & { guiaNombre: string | null; inscritos: number }>(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."horarioCurso", cc."salon", cc."guia",
            g."nombreCompleto" AS "guiaNombre",
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
              WHERE pe."tipoUsuario"='BENEFICIARIO' AND pe."campaign"=cc."campaign"
                AND pe."tipoCurso"=cc."tipoCurso" AND pe."horarioCurso"=cc."horarioCurso"
                AND ${cupoOcupadoSql('pe')}) AS "inscritos"
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE cc."activa" = true
      ORDER BY cc."campaign", cc."tipoCurso", cc."salon" NULLS LAST, cc."horarioCurso"`
  );
}

async function cursoPorId(cursoId: string): Promise<Curso> {
  const c = await queryOne<Curso>(
    `SELECT "_id","campaign","tipoCurso","horarioCurso","salon","guia"
       FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoId]
  );
  if (!c) throw new NotFoundError('Curso de campaña', cursoId);
  return c;
}

interface Alumno {
  academicaId: string | null; peopleId: string; nombre: string; numeroId: string | null;
  curso: string | null; modulo: string | null; leccion: string | null;
}

/** Alumnos que ocupan cupo en el salón, con su ficha académica y su posición actual. */
async function alumnosDelSalon(c: Curso): Promise<Alumno[]> {
  return queryMany<Alumno>(
    `SELECT a."_id" AS "academicaId", p."_id" AS "peopleId",
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."numeroId", a."curso", a."nivel" AS modulo, a."step" AS leccion
       FROM "PEOPLE" p
       -- La ficha académica del alumno: por su enlace directo y, si falta, por documento.
       LEFT JOIN LATERAL (
         SELECT x."_id", x."curso", x."nivel", x."step" FROM "ACADEMICA" x
          WHERE x."peopleId" = p."_id" OR x."numeroId" = p."numeroId"
          ORDER BY (x."peopleId" = p."_id") DESC NULLS LAST, x."_createdDate" DESC
          LIMIT 1
       ) a ON true
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3
        AND ${cupoOcupadoSql('p')}
      ORDER BY UPPER(p."primerApellido"), UPPER(p."primerNombre")`,
    [c.campaign, c.tipoCurso, c.horarioCurso]
  );
}

/** Lista del salón; con módulo y lección, además la vista previa de cada alumno. */
export async function previewAjusteMasivo(cursoId: string, modulo?: string, leccion?: string, retroceder = false) {
  const c = await cursoPorId(cursoId);
  const alumnos = await alumnosDelSalon(c);
  if (alumnos.length > MAX_ALUMNOS_AJUSTE) {
    throw new ValidationError(`El salón tiene ${alumnos.length} alumnos; el máximo por ajuste es ${MAX_ALUMNOS_AJUSTE}.`);
  }

  const filas = [];
  for (const al of alumnos) {
    const base = { ...al, accion: null as AccionAjuste | null, aprobar: 0, aprobarEval: 0, perder: 0, perderEval: 0, error: null as string | null };
    if (!modulo || !leccion) { filas.push(base); continue; }
    if (!al.academicaId) { filas.push({ ...base, accion: 'NO_ENCONTRADA' as AccionAjuste, error: 'Sin ficha académica' }); continue; }
    try {
      const p = await previewMovimiento(al.academicaId, modulo, leccion);
      const accion: AccionAjuste =
        p.bloqueadoWelcome ? 'WELCOME'
        : !p.encontrado ? 'NO_ENCONTRADA'
        : p.direccion === 'adelante' ? 'APLICA'
        : p.direccion === 'atras' ? (retroceder ? 'RETROCEDE' : 'MAS_ADELANTE') : 'IGUAL';
      filas.push({
        ...base, accion,
        aprobar: accion === 'APLICA' ? p.aprobar : 0, aprobarEval: accion === 'APLICA' ? p.aprobarEval : 0,
        perder: accion === 'RETROCEDE' ? p.perder : 0, perderEval: accion === 'RETROCEDE' ? p.perderEval : 0,
      });
    } catch (e: any) {
      filas.push({ ...base, accion: 'NO_ENCONTRADA' as AccionAjuste, error: e?.message || 'Error' });
    }
  }

  const resumen = {
    total: filas.length,
    aplica: filas.filter(f => f.accion === 'APLICA').length,
    retrocede: filas.filter(f => f.accion === 'RETROCEDE').length,
    masAdelante: filas.filter(f => f.accion === 'MAS_ADELANTE').length,
    igual: filas.filter(f => f.accion === 'IGUAL').length,
    welcome: filas.filter(f => f.accion === 'WELCOME').length,
    noEncontrada: filas.filter(f => f.accion === 'NO_ENCONTRADA').length,
  };
  return { curso: c, alumnos: filas, resumen };
}

/**
 * Aplica el ajuste a los alumnos marcados. Sólo se aceptan alumnos de ESE salón
 * (el navegador no decide a quién se mueve) y cada uno se re-evalúa al escribir.
 */
export async function aplicarAjusteMasivo(
  cursoId: string, modulo: string, leccion: string, motivo: string, academicaIds: string[],
  actor: { email?: string | null; nombre?: string | null },
  permitirRetroceso = false
) {
  if (!modulo || !leccion) throw new ValidationError('Elige el módulo y la lección destino.');
  const mot = String(motivo || '').trim();
  if (!mot) throw new ValidationError('El motivo es obligatorio.');
  const pedidos = Array.from(new Set((academicaIds || []).filter(Boolean)));
  if (!pedidos.length) throw new ValidationError('No hay alumnos seleccionados.');
  if (pedidos.length > MAX_ALUMNOS_AJUSTE) throw new ValidationError(`Máximo ${MAX_ALUMNOS_AJUSTE} alumnos por ajuste.`);

  const c = await cursoPorId(cursoId);
  const delSalon = new Map((await alumnosDelSalon(c)).filter(a => a.academicaId).map(a => [a.academicaId as string, a]));

  const resultados: Array<{ academicaId: string; nombre: string; ok: boolean; detalle: string }> = [];
  // En serie: cada ajuste lee y escribe los agendamientos del alumno; en paralelo
  // se agotaría el pool de conexiones con un salón grande.
  for (const id of pedidos) {
    const al = delSalon.get(id);
    if (!al) { resultados.push({ academicaId: id, nombre: id, ok: false, detalle: 'No pertenece a este salón' }); continue; }
    try {
      const r = await ejecutarMovimiento(id, modulo, leccion, actor, `Salón ${c.campaign} · ${c.tipoCurso} · ${c.salon || '—'}. ${mot}`,
        { soloAdelante: !permitirRetroceso, origen: ORIGEN_AJUSTE_MASIVO });
      resultados.push({
        academicaId: id, nombre: al.nombre, ok: true,
        detalle: r.direccion === 'atras'
          ? `${r.de} → ${r.a} · ${r.perdidas} lección(es) des-aprobada(s)${r.evaluacionesPerdidas ? ` (incl. ${r.evaluacionesPerdidas} evaluación/es)` : ''}`
          : `${r.de} → ${r.a} · ${r.aprobadas} lección(es) aprobada(s)${r.evaluacionesAprobadas ? ` (incl. ${r.evaluacionesAprobadas} evaluación/es)` : ''}`,
      });
    } catch (e: any) {
      resultados.push({ academicaId: id, nombre: al.nombre, ok: false, detalle: e?.message || 'Error' });
    }
  }
  // El salón entero se reposiciona: desde su próxima sesión el calendario sigue en la
  // lección elegida, que es la que verá el guía. Sólo si el destino queda por delante
  // de la próxima sesión (registrarSaltoSalon lo comprueba) y SIEMPRE, también cuando
  // se marcó "permitir retroceder": esa casilla decide qué pasa con los ALUMNOS que
  // van más adelante, no con el calendario del salón. Antes se omitía con ella y el
  // guía seguía viendo la lección vieja.
  let calendario: { aplicado: boolean; desde?: string } = { aplicado: false };
  if (resultados.some(r => r.ok)) {
    try { calendario = await registrarSaltoSalon(cursoId, modulo, leccion, actor?.email); }
    catch (e: any) { console.warn('[ajuste-masivo] salto de calendario:', e?.message); }
  }
  return {
    ok: resultados.filter(r => r.ok).length,
    fail: resultados.filter(r => !r.ok).length,
    resultados,
    calendario,
  };
}
