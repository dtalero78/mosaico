import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { EVALUACION_STEP } from './repetir-clase.service';
import { esModuloEvaluacion } from '@/lib/evaluacion';

/**
 * Movimiento Académico (MOSAICO) — cambia el Módulo/Lección del alumno DENTRO de su curso.
 *
 * Opera sobre los bookings del alumno, que ya están mapeados a su lección vía
 * `sesionModulo`/`sesionLeccion`/`leccionOrden` (secuencia del salón, con evaluaciones
 * y refuerzos incluidos):
 *   - HACIA ADELANTE (destino > actual): las lecciones y evaluaciones ANTERIORES al
 *     destino que no estén aprobadas se APRUEBAN (asistio/asistencia=true, noAprobo=false)
 *     y se marcan `movimientoAcademico=true` (nota "Movimiento Académico"). La asistencia
 *     ya marcada de verdad NO se toca.
 *   - HACIA ATRÁS (destino < actual): las lecciones/evaluaciones DESDE el destino en
 *     adelante que estén aprobadas se DES-APRUEBAN (se pierden). Se guarda un snapshot
 *     del estado anterior en la auditoría (cambioStepHistory) para poder revertir.
 *   - La lección destino queda como la nueva posición (pendiente).
 *
 * Alumnos en el puente WELCOME (sin curso real) quedan BLOQUEADOS.
 */

const stripAccents = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s: any) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
const isAprobada = (b: any) => (b.asistio === true || b.asistencia === true) && b.noAprobo !== true && b.cancelo !== true;
const EVAL_NORM = norm(EVALUACION_STEP);

interface Aca { _id: string; numeroId: string | null; curso: string | null; nivel: string | null; step: string | null; }
interface Bk {
  bid: string; sm: string | null; sl: string | null; lo: number | null;
  asistio: boolean | null; asistencia: boolean | null; noAprobo: boolean | null; cancelo: boolean | null;
  movimientoAcademico: boolean | null;
}

async function cargar(academicaId: string): Promise<{ aca: Aca; bookings: Bk[] }> {
  const aca = await queryOne<Aca>(
    `SELECT "_id","numeroId","curso","nivel","step" FROM "ACADEMICA" WHERE "_id"=$1`, [academicaId]
  );
  if (!aca) throw new NotFoundError('Student', academicaId);
  const bookings = await queryMany<Bk>(
    `SELECT b."_id" AS "bid", c."sesionModulo" AS "sm", c."sesionLeccion" AS "sl", c."leccionOrden" AS "lo",
            b."asistio", b."asistencia", b."noAprobo", b."cancelo", b."movimientoAcademico"
     FROM "ACADEMICA_BOOKINGS" b
     JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE (b."idEstudiante"=$1 OR b."studentId"=$1) AND c."sesionLeccion" IS NOT NULL`,
    [academicaId]
  );
  return { aca, bookings };
}

/** Calcula el plan (sin escribir). */
function planificar(aca: Aca, bookings: Bk[], targetModulo: string, targetLeccion: string) {
  const bloqueadoWelcome = !aca.curso || aca.curso === 'WELCOME';

  const conOrden = bookings.filter(b => b.lo != null);
  const ordenDe = (mod: string | null, lec: string | null): number | null => {
    const hits = conOrden.filter(b => norm(b.sm) === norm(mod) && norm(b.sl) === norm(lec));
    if (!hits.length) return null;
    return Math.min(...hits.map(b => b.lo as number));
  };

  const targetOrder = ordenDe(targetModulo, targetLeccion);
  let currentOrder = ordenDe(aca.nivel, aca.step);
  if (currentOrder == null) {
    // Fallback: la posición actual = 1 + el mayor orden aprobado (o 1 si no hay).
    const aprobadosOrd = conOrden.filter(isAprobada).map(b => b.lo as number);
    currentOrder = aprobadosOrd.length ? Math.max(...aprobadosOrd) + 1 : 1;
  }

  const direction: 'adelante' | 'atras' | 'igual' =
    targetOrder == null ? 'igual'
    : targetOrder > currentOrder ? 'adelante'
    : targetOrder < currentOrder ? 'atras' : 'igual';

  let aAprobar: Bk[] = [], aDesaprobar: Bk[] = [];
  if (targetOrder != null) {
    if (direction === 'adelante') {
      aAprobar = conOrden.filter(b => (b.lo as number) < targetOrder && !isAprobada(b));
    } else if (direction === 'atras') {
      aDesaprobar = conOrden.filter(b => (b.lo as number) >= targetOrder && isAprobada(b));
    }
  }
  // Evaluación = la declarada en NIVELES (su módulo lo es) o la sintética legacy.
  const esEval = (b: Bk) => esModuloEvaluacion(b.sm) || norm(b.sl) === EVAL_NORM;

  return {
    bloqueadoWelcome, targetOrder, currentOrder, direction,
    aprobar: aAprobar.length,
    aprobarEval: aAprobar.filter(esEval).length,
    perder: aDesaprobar.length,
    perderEval: aDesaprobar.filter(esEval).length,
    _aAprobar: aAprobar, _aDesaprobar: aDesaprobar,
  };
}

/** Vista previa del impacto (para la confirmación del modal). */
export async function previewMovimiento(academicaId: string, targetModulo: string, targetLeccion: string) {
  const { aca, bookings } = await cargar(academicaId);
  const p = planificar(aca, bookings, targetModulo, targetLeccion);
  return {
    bloqueadoWelcome: p.bloqueadoWelcome,
    actual: { campaign: null as string | null, curso: aca.curso, modulo: aca.nivel, leccion: aca.step, orden: p.currentOrder },
    destino: { modulo: targetModulo, leccion: targetLeccion, orden: p.targetOrder },
    direccion: p.direction,
    encontrado: p.targetOrder != null,
    aprobar: p.aprobar, aprobarEval: p.aprobarEval,
    perder: p.perder, perderEval: p.perderEval,
  };
}

/** Ejecuta el movimiento. */
export async function ejecutarMovimiento(
  academicaId: string, targetModulo: string, targetLeccion: string,
  actor: { email?: string | null; nombre?: string | null }, motivo?: string
) {
  const { aca, bookings } = await cargar(academicaId);
  if (!aca.curso || aca.curso === 'WELCOME') {
    throw new ValidationError('El alumno está en el puente WELCOME; promuévelo a su curso real antes de moverlo.');
  }
  const p = planificar(aca, bookings, targetModulo, targetLeccion);
  if (p.targetOrder == null) {
    throw new ValidationError(`La lección "${targetModulo} · ${targetLeccion}" no está en la secuencia del alumno.`);
  }
  if (p.direction === 'igual') {
    throw new ValidationError('El destino es la misma posición actual; no hay cambio que aplicar.');
  }

  // Snapshot del estado anterior de los bookings afectados (para revertir).
  const afectados = [...p._aAprobar, ...p._aDesaprobar];
  const snapshot = afectados.map(b => ({
    bid: b.bid, modulo: b.sm, leccion: b.sl, orden: b.lo,
    asistio: b.asistio, asistencia: b.asistencia, noAprobo: b.noAprobo, movimientoAcademico: b.movimientoAcademico,
  }));

  // ADELANTE: aprobar (solo los que no estaban aprobados) con marca de movimiento.
  if (p._aAprobar.length) {
    const ids = p._aAprobar.map(b => b.bid);
    await query(
      `UPDATE "ACADEMICA_BOOKINGS"
          SET "asistio"=true, "asistencia"=true, "noAprobo"=false, "movimientoAcademico"=true, "_updatedDate"=NOW()
        WHERE "_id" = ANY($1)`, [ids]
    );
  }
  // ATRÁS: des-aprobar (se pierden).
  if (p._aDesaprobar.length) {
    const ids = p._aDesaprobar.map(b => b.bid);
    await query(
      `UPDATE "ACADEMICA_BOOKINGS"
          SET "asistio"=false, "asistencia"=false, "noAprobo"=false, "movimientoAcademico"=false, "_updatedDate"=NOW()
        WHERE "_id" = ANY($1)`, [ids]
    );
  }

  // Nueva posición del alumno.
  const histEntry = JSON.stringify([{
    fecha: new Date().toISOString(),
    tipo: 'MOVIMIENTO_ACADEMICO',
    de: `${aca.nivel} · ${aca.step}`,
    a: `${targetModulo} · ${targetLeccion}`,
    direccion: p.direction,
    aprobadas: p.aprobar, evaluacionesAprobadas: p.aprobarEval,
    perdidas: p.perder, evaluacionesPerdidas: p.perderEval,
    motivo: motivo || '',
    realizadoPor: actor?.email || 'system',
    realizadoPorNombre: actor?.nombre || null,
    snapshot,
  }]);
  await query(
    `UPDATE "ACADEMICA"
        SET "nivel"=$2, "step"=$3,
            "cambioStepHistory" = COALESCE("cambioStepHistory",'[]'::jsonb) || $4::jsonb,
            "_updatedDate"=NOW()
      WHERE "_id"=$1`,
    [academicaId, targetModulo, targetLeccion, histEntry]
  ).catch(async () => {
    await query(`UPDATE "ACADEMICA" SET "nivel"=$2, "step"=$3, "_updatedDate"=NOW() WHERE "_id"=$1`, [academicaId, targetModulo, targetLeccion]);
  });
  if (aca.numeroId) {
    await query(
      `UPDATE "PEOPLE" SET "nivel"=$2, "step"=$3, "_updatedDate"=NOW() WHERE "numeroId"=$1 AND "tipoUsuario"='BENEFICIARIO'`,
      [aca.numeroId, targetModulo, targetLeccion]
    ).catch(() => {});
  }
  // Comentario en PEOPLE (traza).
  if (aca.numeroId) {
    const texto = `[Movimiento Académico] ${aca.nivel} · ${aca.step} → ${targetModulo} · ${targetLeccion} (${p.direction}; +${p.aprobar} aprobadas / -${p.perder} des-aprobadas).${motivo ? ' ' + motivo : ''} Por: ${actor?.nombre || actor?.email || 'system'}`;
    await query(
      `UPDATE "PEOPLE" SET "comentarios" = COALESCE("comentarios",'[]'::jsonb) || $2::jsonb, "_updatedDate"=NOW()
        WHERE "numeroId"=$1 AND "tipoUsuario"='BENEFICIARIO'`,
      [aca.numeroId, JSON.stringify([{ texto, areaRemitente: 'Académico', areaDestinatario: 'General', fecha: new Date().toISOString(), autor: actor?.nombre || actor?.email || 'system' }])]
    ).catch(() => {});
  }

  return {
    ok: true, direccion: p.direction,
    de: `${aca.nivel} · ${aca.step}`, a: `${targetModulo} · ${targetLeccion}`,
    aprobadas: p.aprobar, evaluacionesAprobadas: p.aprobarEval,
    perdidas: p.perder, evaluacionesPerdidas: p.perderEval,
  };
}
