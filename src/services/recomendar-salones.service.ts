import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError } from '@/lib/errors';
import { EVALUACION_STEP } from './repetir-clase.service';

/**
 * Barrido de salones — recomienda a qué CAMPAÑA/SALÓN del MISMO curso mover a un alumno
 * para que quede en su MISMA lección (transferencia sin saltos).
 *
 * Cada salón (CURSOS_CAMPAIGN activo del mismo tipoCurso) tiene una "lección actual" = la
 * de su próximo evento futuro mapeado. Se compara con la lección actual del alumno usando el
 * `orden` de NIVELES (pedagógico, igual para todos los salones del tipo). El `gap` = orden del
 * salón − orden del alumno: 0 = misma lección (ideal); >0 = el alumno adelantaría (se saltaría
 * lecciones); <0 = repetiría. Se ordena por |gap| y, a igualdad, por cupo disponible.
 */

const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const EVAL_NORM = norm(EVALUACION_STEP);

export async function recomendarSalones(academicaId: string) {
  const aca = await queryOne<{ curso: string | null; nivel: string | null; step: string | null; numeroId: string | null }>(
    `SELECT "curso","nivel","step","numeroId" FROM "ACADEMICA" WHERE "_id"=$1`, [academicaId]
  );
  if (!aca) throw new NotFoundError('Student', academicaId);

  // Curso real y salón actual del alumno (desde PEOPLE beneficiario).
  const people = aca.numeroId
    ? await queryOne<any>(`SELECT "campaign","tipoCurso","horarioCurso","salon" FROM "PEOPLE" WHERE "numeroId"=$1 AND "tipoUsuario"='BENEFICIARIO' LIMIT 1`, [aca.numeroId])
    : null;
  const curso = (aca.curso && aca.curso !== 'WELCOME') ? aca.curso : (people?.tipoCurso || aca.curso);
  if (!curso || curso === 'WELCOME') {
    return { bloqueadoWelcome: true, student: null, candidatos: [] as any[] };
  }

  // cursoCampaignId actual (para excluirlo).
  const currentCC = (people?.campaign && people?.horarioCurso)
    ? (await queryOne<{ _id: string }>(`SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
        [people.campaign, curso, people.horarioCurso]))?._id || null
    : null;

  // Mapa de orden de NIVELES del curso: (code||step)->orden y por módulo su orden máx (para las evaluaciones).
  const niveles = await queryMany<{ code: string; step: string; orden: number | null }>(
    `SELECT "code","step","orden" FROM "NIVELES" WHERE "curso"=$1 AND "step" <> 'WELCOME'`, [curso]
  );
  const ordenPorLeccion = new Map<string, number>();
  const ordenMaxPorModulo = new Map<string, number>();
  for (const n of niveles) {
    if (n.orden == null) continue;
    ordenPorLeccion.set(`${norm(n.code)}||${norm(n.step)}`, n.orden);
    const cur = ordenMaxPorModulo.get(norm(n.code));
    if (cur == null || n.orden > cur) ordenMaxPorModulo.set(norm(n.code), n.orden);
  }
  const ordenDe = (modulo: string | null, leccion: string | null): number | null => {
    if (!leccion) return null;
    if (norm(leccion) === EVAL_NORM) { // evaluación → justo después de la última lección del módulo
      const m = ordenMaxPorModulo.get(norm(modulo));
      return m != null ? m + 0.5 : null;
    }
    const o = ordenPorLeccion.get(`${norm(modulo)}||${norm(leccion)}`);
    return o == null ? null : o;
  };

  const ordenStudent = ordenDe(aca.nivel, aca.step);

  // Salones candidatos: mismo tipoCurso, activos, distinto del actual.
  const cursos = await queryMany<any>(
    `SELECT "_id","campaign","salon","horarioCurso","guia","numeroUsuarios","usuInscritos"
     FROM "CURSOS_CAMPAIGN" WHERE "tipoCurso"=$1 AND "activa"=true AND ($2::text IS NULL OR "_id" <> $2)`,
    [curso, currentCC]
  );

  const guiaIds = [...new Set(cursos.map(c => c.guia).filter(Boolean))];
  const guiasMap = new Map<string, string>();
  if (guiaIds.length) {
    const gs = await query<{ _id: string; nombreCompleto: string }>(
      `SELECT "_id","nombreCompleto" FROM "GUIAS" WHERE "_id" = ANY($1)`, [guiaIds]
    );
    gs.rows.forEach(g => guiasMap.set(g._id, g.nombreCompleto));
  }

  const candidatos: any[] = [];
  for (const c of cursos) {
    // Lección actual del salón = próximo evento futuro mapeado (o el último si terminó).
    let lec = await queryOne<{ sm: string | null; sl: string | null }>(
      `SELECT "sesionModulo" sm,"sesionLeccion" sl FROM "CALENDARIO"
       WHERE "cursoCampaignId"=$1 AND "dia">=NOW() AND "sesionLeccion" IS NOT NULL ORDER BY "dia" ASC LIMIT 1`, [c._id]
    );
    if (!lec?.sl) {
      lec = await queryOne<{ sm: string | null; sl: string | null }>(
        `SELECT "sesionModulo" sm,"sesionLeccion" sl FROM "CALENDARIO"
         WHERE "cursoCampaignId"=$1 AND "sesionLeccion" IS NOT NULL ORDER BY "dia" DESC LIMIT 1`, [c._id]
      );
    }
    const ordenSalon = ordenDe(lec?.sm ?? null, lec?.sl ?? null);
    const gap = (ordenSalon != null && ordenStudent != null) ? Math.round((ordenSalon - ordenStudent)) : null;
    const cupos = { inscritos: Number(c.usuInscritos) || 0, total: Number(c.numeroUsuarios) || 0 };
    candidatos.push({
      cursoCampaignId: c._id,
      campaign: c.campaign, salon: c.salon, horarioCurso: c.horarioCurso,
      guia: guiasMap.get(c.guia) || null,
      moduloActual: lec?.sm ?? null, leccionActual: lec?.sl ?? null,
      gap, mismaLeccion: gap === 0,
      cupos, lleno: cupos.total > 0 && cupos.inscritos >= cupos.total,
    });
  }

  // Orden: primero los que tienen gap (calculable), por |gap| asc; a igualdad, con cupo primero.
  candidatos.sort((a, b) => {
    if (a.gap == null && b.gap == null) return 0;
    if (a.gap == null) return 1;
    if (b.gap == null) return -1;
    const d = Math.abs(a.gap) - Math.abs(b.gap);
    if (d !== 0) return d;
    return (a.lleno ? 1 : 0) - (b.lleno ? 1 : 0);
  });

  return {
    bloqueadoWelcome: false,
    student: { curso, modulo: aca.nivel, leccion: aca.step, orden: ordenStudent, campaign: people?.campaign || null, salon: people?.salon || null },
    candidatos,
  };
}
