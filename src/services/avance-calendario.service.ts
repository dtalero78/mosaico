import 'server-only';
import { query, queryMany } from '@/lib/postgres';
import { cupoOcupadoSql } from '@/lib/cupo';
import { eventEndDate } from '@/lib/event-duration';

/**
 * Avance por CALENDARIO (MOSAICO).
 *
 * La posición del alumno (módulo y lección) deja de depender de su asistencia y pasa
 * a depender de las sesiones que su salón YA dictó: antes de la primera clase está
 * en la primera lección; cuando una sesión TERMINA, pasa a la lección de la
 * siguiente. Es la misma para todos los alumnos del salón.
 *
 * La lección de cada sesión ya está en CALENDARIO (`sesionModulo`/`sesionLeccion`,
 * que `mapearLeccionesSalon` reparte teniendo en cuenta repeticiones, festivos,
 * suspensiones y las clases de dos lecciones). Una sesión de dos lecciones muestra la
 * PRIMERA hasta que termina; después, la primera de la sesión siguiente.
 *
 * Quedan fuera:
 *  - IMPULSA: tiene su propio calendario y su propio avance.
 *  - Quien no ocupa cupo (pausa/OnHold, cupo liberado, contrato anulado, inactivado
 *    por un admin, contrato de prueba): conserva la lección en que venía. Al
 *    reactivarse se le busca un salón que vaya en esa lección.
 *  - Salones sin sesiones por dictar (el curso terminó).
 */

export interface PosicionSalon { modulo: string; leccion: string; orden?: number | null }

/** Posición actual de varios salones: la lección de la primera sesión que aún no terminó. */
export async function posicionesDeSalones(cursoIds: string[], now: Date = new Date()): Promise<Map<string, PosicionSalon>> {
  const out = new Map<string, PosicionSalon>();
  if (!cursoIds.length) return out;
  // Una sesión dura a lo sumo unas horas: con 12 h de margen atrás se captura la que
  // pueda estar en curso. Se traen pocas filas por salón y se decide en memoria
  // (la duración depende del horario del curso).
  const rows = await queryMany<{
    cid: string; dia: string; tipo: string | null; nombreEvento: string | null; duracionMin: number | null;
    sm: string | null; sl: string | null; lo: number | null;
  }>(
    `SELECT cc."_id" AS cid, s."dia"::text AS dia, s."tipo", s."nombreEvento", s."duracionMin",
            s."sesionModulo" AS sm, s."sesionLeccion" AS sl, s."leccionOrden" AS lo
       FROM "CURSOS_CAMPAIGN" cc
       CROSS JOIN LATERAL (
         SELECT c."dia", c."tipo", c."nombreEvento", c."duracionMin", c."sesionModulo", c."sesionLeccion", c."leccionOrden"
           FROM "CALENDARIO" c
          WHERE c."cursoCampaignId" = cc."_id" AND c."sesionLeccion" IS NOT NULL
            AND c."dia" >= $2::timestamptz - INTERVAL '12 hours'
          ORDER BY c."dia" ASC LIMIT 3) s
      WHERE cc."_id" = ANY($1)`,
    [cursoIds, now.toISOString()]
  );
  for (const r of rows) {
    if (out.has(r.cid) || !r.sl || !r.sm) continue;
    const fin = eventEndDate(new Date(r.dia), r.tipo, r.nombreEvento, r.duracionMin);
    if (fin.getTime() > now.getTime()) out.set(r.cid, { modulo: r.sm, leccion: r.sl, orden: r.lo });
  }
  return out;
}

export async function posicionDeSalon(cursoId: string, now: Date = new Date()): Promise<PosicionSalon | null> {
  return (await posicionesDeSalones([cursoId], now)).get(cursoId) || null;
}

export interface CambioAvance {
  peopleId: string;
  academicaId: string | null;
  nombre: string;
  curso: string;
  salon: string;
  peopleAntes: string;
  academicaAntes: string | null;
  despues: string;
}

export interface ResultadoAvance {
  salonesRevisados: number;
  salonesConPosicion: number;
  salonesSinEquivalente: Array<{ salon: string; posicion: string }>;
  alumnosRevisados: number;
  /** Ajustados a mano hacia adelante y aún por delante de su salón: no se tocan. */
  alumnosFijados: number;
  alumnosCambiados: number;
  academicaActualizadas: number;
  peopleActualizadas: number;
  cambios: CambioAvance[];
}

const eq = (a: any, b: any) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * Lleva a cada alumno a la posición de su salón. Idempotente: si ya está donde toca
 * no escribe nada. `dryRun` calcula sin escribir.
 */
export async function sincronizarAvanceCalendario(
  opts: { dryRun?: boolean; campaign?: string; now?: Date } = {}
): Promise<ResultadoAvance> {
  const now = opts.now || new Date();
  const salones = await queryMany<{ _id: string; campaign: string; tipoCurso: string; horarioCurso: string; salon: string | null }>(
    `SELECT "_id","campaign","tipoCurso","horarioCurso","salon" FROM "CURSOS_CAMPAIGN"
      WHERE "activa" = true AND UPPER("tipoCurso") <> 'IMPULSA'
        AND ($1::text IS NULL OR "campaign" = $1)`,
    [opts.campaign || null]
  );
  const posiciones = await posicionesDeSalones(salones.map(s => s._id), now);

  // Sólo se escriben posiciones que existan en el currículo (NIVELES). Los salones que
  // dictaron la evaluación "sintética" por módulo (CURSOS_CAMPAIGN.evalSinteticaPorModulo)
  // traen sesiones con la lección «Evaluación», que NIVELES no tiene: a esos alumnos no se
  // les escribe nada hasta que la sesión siguiente vuelva a una lección real.
  const norm = (x: any) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const curriculo = new Set<string>();
  for (const n of await queryMany<{ curso: string; code: string; step: string }>(`SELECT "curso","code","step" FROM "NIVELES"`)) {
    curriculo.add(`${norm(n.curso)}||${norm(n.code)}||${norm(n.step)}`);
  }

  // Orden de cada (módulo, lección) en el calendario de cada salón: sirve para saber si
  // un alumno ajustado a mano va por delante de lo que su salón ha dictado.
  const ordenSalon = new Map<string, number>();
  if (salones.length) {
    for (const r of await queryMany<{ cid: string; sm: string; sl: string; lo: number }>(
      `SELECT "cursoCampaignId" AS cid, "sesionModulo" AS sm, "sesionLeccion" AS sl, MIN("leccionOrden") AS lo
         FROM "CALENDARIO"
        WHERE "cursoCampaignId" = ANY($1) AND "sesionLeccion" IS NOT NULL AND "leccionOrden" IS NOT NULL
        GROUP BY 1,2,3`,
      [salones.map(x => x._id)]
    )) ordenSalon.set(`${r.cid}||${norm(r.sm)}||${norm(r.sl)}`, Number(r.lo));
  }

  const res: ResultadoAvance = {
    salonesRevisados: salones.length, salonesConPosicion: posiciones.size,
    salonesSinEquivalente: [], alumnosRevisados: 0, alumnosFijados: 0, alumnosCambiados: 0, academicaActualizadas: 0, peopleActualizadas: 0, cambios: [],
  };

  const acadIds: string[] = [], acadMod: string[] = [], acadLec: string[] = [];
  const peopleIds: string[] = [], peopleMod: string[] = [], peopleLec: string[] = [];

  for (const s of salones) {
    const pos = posiciones.get(s._id);
    if (!pos) continue;
    if (!curriculo.has(`${norm(s.tipoCurso)}||${norm(pos.modulo)}||${norm(pos.leccion)}`)) {
      res.salonesSinEquivalente.push({ salon: `${s.campaign} · ${s.tipoCurso} · ${s.horarioCurso}`, posicion: `${pos.modulo} / ${pos.leccion}` });
      continue;
    }
    const alumnos = await queryMany<any>(
      `SELECT p."_id" AS pid, p."nivel" AS pnivel, p."step" AS pstep, p."primerNombre", p."primerApellido",
              a."_id" AS aid, a."curso" AS acurso, a."nivel" AS anivel, a."step" AS astep,
              a."movA" AS "movA", a."movDir" AS "movDir"
         FROM "PEOPLE" p
         LEFT JOIN LATERAL (
           SELECT x."_id", x."curso", x."nivel", x."step",
                  (SELECT t.e->>'a' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x."cambioStepHistory")='array' THEN x."cambioStepHistory" ELSE '[]'::jsonb END)
                          WITH ORDINALITY t(e,i) WHERE t.e->>'tipo'='MOVIMIENTO_ACADEMICO' ORDER BY t.i DESC LIMIT 1) AS "movA",
                  (SELECT t.e->>'direccion' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x."cambioStepHistory")='array' THEN x."cambioStepHistory" ELSE '[]'::jsonb END)
                          WITH ORDINALITY t(e,i) WHERE t.e->>'tipo'='MOVIMIENTO_ACADEMICO' ORDER BY t.i DESC LIMIT 1) AS "movDir"
             FROM "ACADEMICA" x
            WHERE x."numeroId" = p."numeroId"
            ORDER BY (x."peopleId" = p."_id") DESC NULLS LAST, (x."tipoUsuario" = 'BENEFICIARIO') DESC NULLS LAST
            LIMIT 1) a ON true
        WHERE p."tipoUsuario" = 'BENEFICIARIO'
          AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3
          AND ${cupoOcupadoSql('p')}`,
      [s.campaign, s.tipoCurso, s.horarioCurso]
    );
    for (const al of alumnos) {
      res.alumnosRevisados++;
      // Ajustado a mano HACIA ADELANTE y todavía por delante de su salón: se respeta.
      // Cuando el calendario lo alcanza la posición coincide y no hay nada que proteger;
      // si luego el salón lo rebasa, vuelve a seguir al calendario.
      if (al.aid && al.movDir === 'adelante' && norm(al.movA) === norm(`${al.anivel} · ${al.astep}`)) {
        const suyo = ordenSalon.get(`${s._id}||${norm(al.anivel)}||${norm(al.astep)}`);
        if (suyo != null && pos.orden != null && suyo > pos.orden) { res.alumnosFijados++; continue; }
      }
      // ACADEMICA sólo se toca si el alumno ya está en su curso real; en el puente
      // WELCOME conserva su etiqueta y se adelanta únicamente PEOPLE (el curso real).
      const acadEnCurso = al.aid && String(al.acurso || '').toUpperCase() === String(s.tipoCurso).toUpperCase();
      const peopleIgual = eq(al.pnivel, pos.modulo) && eq(al.pstep, pos.leccion);
      const acadIgual = !acadEnCurso || (eq(al.anivel, pos.modulo) && eq(al.astep, pos.leccion));
      if (peopleIgual && acadIgual) continue;

      res.alumnosCambiados++;
      res.cambios.push({
        peopleId: al.pid, academicaId: al.aid || null,
        nombre: `${al.primerNombre || ''} ${al.primerApellido || ''}`.trim(),
        curso: s.tipoCurso, salon: `${s.campaign} · ${s.horarioCurso}`,
        peopleAntes: `${al.pnivel} / ${al.pstep}`,
        academicaAntes: acadEnCurso ? `${al.anivel} / ${al.astep}` : null,
        despues: `${pos.modulo} / ${pos.leccion}`,
      });
      if (!peopleIgual) { peopleIds.push(al.pid); peopleMod.push(pos.modulo); peopleLec.push(pos.leccion); }
      if (!acadIgual) { acadIds.push(al.aid); acadMod.push(pos.modulo); acadLec.push(pos.leccion); }
    }
  }

  if (!opts.dryRun) {
    if (acadIds.length) {
      const r = await query(
        `UPDATE "ACADEMICA" a SET "nivel" = v.m, "step" = v.l, "_updatedDate" = NOW()
           FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS m, unnest($3::text[]) AS l) v
          WHERE a."_id" = v.id`, [acadIds, acadMod, acadLec]);
      res.academicaActualizadas = r.rowCount ?? 0;
    }
    if (peopleIds.length) {
      const r = await query(
        `UPDATE "PEOPLE" p SET "nivel" = v.m, "step" = v.l, "_updatedDate" = NOW()
           FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS m, unnest($3::text[]) AS l) v
          WHERE p."_id" = v.id`, [peopleIds, peopleMod, peopleLec]);
      res.peopleActualizadas = r.rowCount ?? 0;
    }
  }
  return res;
}
