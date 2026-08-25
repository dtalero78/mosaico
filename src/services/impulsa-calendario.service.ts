import 'server-only';
import { query } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import {
  computeImpulsaCalendario, type ImpulsaConfig, type EventoImpulsa,
} from '@/lib/impulsa-calendario';

export interface CursoImpulsa {
  _id: string;
  campaign: string;
  tipoCurso: string;     // 'IMPULSA'
  salon?: string | null;
  guia?: string | null;  // GUIAS._id
  numeroUsuarios?: number | null;
  horarioCurso?: string | null; // "LUN-MIÉ-VIE 20:00-21:00"
}

const nombreEventoDe = (ev: EventoImpulsa, curso: CursoImpulsa): string =>
  ev.tipo === 'SESSION' ? (curso.horarioCurso || `${ev.horaInicio}-${ev.horaFin}`)
  : ev.tipo === 'ENTRENAMIENTO' ? 'Entrenamiento'
  : 'Evaluación';

/**
 * Asigna `sesionModulo`/`sesionLeccion` a los eventos IMPULSA de un curso.
 *
 * El curso avanza por el currículo de NIVELES **en una sola secuencia**, en orden
 * de fecha, y cada clase consume las lecciones que dura:
 *   - **SESSION** (1 h) → 1 lección.
 *   - **ENTRENAMIENTO** y **EVALUACION** (bloque de 2 h) → **2 lecciones**, que se
 *     guardan en `sesionLeccion` y `sesionLeccion2`.
 *
 * Antes se llevaba un contador POR TIPO —las sesiones sólo tomaban lecciones de
 * "Modulo NN"— y eso saltaba las de entrenamiento: en el curso vivo la sesión del
 * viernes 21-ago se llevó la lección 08 y todo lo posterior quedó una lección
 * adelantado (el lunes 24 mostraba la 09 en vez de la 08). La posición REAL de los
 * alumnos en ACADEMICA, que avanza con la asistencia, seguía la secuencia única.
 *
 * Si el currículo se agota antes que el calendario, las clases sobrantes quedan
 * **sin lección** en vez de repetir la última: una etiqueta inventada haría creer
 * que hay contenido donde no lo hay, y al cargar lo que falta se completa sola.
 */
export async function asignarLeccionesImpulsa(cursoCampaignId: string): Promise<void> {
  /** Lecciones que consume una clase según su tipo. */
  const leccionesDe = (tipo: string) => {
    const t = String(tipo || '').toUpperCase();
    return t === 'ENTRENAMIENTO' || t === 'EVALUACION' ? 2 : 1;
  };
  const catEv = (tipo: string) => {
    const t = String(tipo || '').toUpperCase();
    return t === 'ENTRENAMIENTO' ? 'ENTREN' : t === 'EVALUACION' ? 'EVALUAC' : (t === 'SESSION' || t === 'SESION') ? 'MODULO' : null;
  };
  const nv = (await query<{ code: string; step: string }>(
    // NULLS LAST + "step" de desempate: una lección sin orden no debe encabezar la
    // secuencia ni quedar a merced del orden físico de la tabla.
    `SELECT "code","step" FROM "NIVELES" WHERE UPPER("curso")='IMPULSA'
      ORDER BY "orden" ASC NULLS LAST, "step" ASC`
  )).rows;
  const ev = (await query<{ _id: string; tipo: string }>(
    `SELECT "_id","tipo" FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 ORDER BY "dia" ASC, "_id" ASC`, [cursoCampaignId]
  )).rows;

  const limpiar = (id: string) => query(
    `UPDATE "CALENDARIO" SET "sesionModulo"=NULL,"sesionLeccion"=NULL,"sesionModulo2"=NULL,"sesionLeccion2"=NULL WHERE "_id"=$1`, [id]
  );

  let cursor = 0;
  for (const e of ev) {
    if (!catEv(e.tipo)) continue;             // tipo desconocido: no consume currículo
    const n = leccionesDe(e.tipo);
    const l1 = nv[cursor], l2 = n === 2 ? nv[cursor + 1] : undefined;
    cursor += n;                              // el cursor avanza aunque falte currículo
    if (!l1) { await limpiar(e._id); continue; }
    await query(
      `UPDATE "CALENDARIO" SET "sesionModulo"=$2,"sesionLeccion"=$3,"sesionModulo2"=$4,"sesionLeccion2"=$5 WHERE "_id"=$1`,
      [e._id, l1.code, l1.step, l2 ? l2.code : null, l2 ? l2.step : null]
    );
  }
}

/**
 * Materializa el calendario IMPULSA en CALENDARIO (borra los eventos previos del
 * curso y reinserta) y guarda la config en IMPULSA_CURSO_CONFIG. El instante UTC de
 * cada evento se calcula por fecha con `('<fecha> <hora>'::timestamp AT TIME ZONE
 * <authorTz>)` → PostgreSQL aplica el offset IANA correcto (DST incluido).
 *
 * NO toca bookings ni asistencia — la preservación de estado de alumnos (al
 * reconfigurar un curso con inscritos) la maneja el llamador (ver script de
 * reconfiguración), igual que `regenerarCursoPreservandoEstado`.
 */
export async function materializarCalendarioImpulsa(
  curso: CursoImpulsa, cfg: ImpulsaConfig, actor?: string | null,
): Promise<{ count: number; resumen: ReturnType<typeof computeImpulsaCalendario>['resumen'] }> {
  // Los días sin clase declarados por Académico son GLOBALES: aplican también a
  // IMPULSA. Se suman a los que el curso tenga cargados en su propio asistente.
  const { fechasFestivasPersonalizadas } = await import('./festivos-personalizados.service');
  const globales = await fechasFestivasPersonalizadas().catch(() => new Set<string>());
  const cfgConFestivos: ImpulsaConfig = {
    ...cfg,
    festivos: Array.from(new Set([...(cfg.festivos || []), ...Array.from(globales)])),
  };
  const calc = computeImpulsaCalendario(cfgConFestivos);
  const tz = calc.authorTz;
  const eventos: EventoImpulsa[] = [...calc.sesiones, ...calc.entrenamientos, ...calc.evaluaciones];

  await query(`DELETE FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [curso._id]);

  if (eventos.length) {
    const cols = '"_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","campaign","curso","salon","_createdDate","_updatedDate"';
    const titulo = [curso.campaign, curso.tipoCurso, (curso.salon || '').trim()].filter(Boolean).join(' - ');
    const advisor = (curso.guia || '').trim();
    const limite = Number(curso.numeroUsuarios) || 0;
    // El link de la sesión es la sala Zoom de la GUÍA asignada (igual para todos
    // los eventos del curso). Sin guía / sin zoom → null (queda sin link).
    let linkZoom: string | null = null;
    if (advisor) {
      const gz = await query<{ zoom: string | null }>(
        `SELECT "zoom" FROM "GUIAS" WHERE "_id" = $1 LIMIT 1`, [advisor]
      ).catch(() => ({ rows: [] as { zoom: string | null }[] }));
      linkZoom = (gz.rows[0]?.zoom || '').trim() || null;
    }
    // $1,$2,$3,$4 = campaign, curso, salon, linkZoom (constantes del curso). Luego 12 params por evento.
    const params: any[] = [curso.campaign, curso.tipoCurso, (curso.salon || '').trim(), linkZoom];
    const rows: string[] = [];
    eventos.forEach((ev, r) => {
      const b = 4 + r * 12;
      rows.push(
        `($${b + 1},$${b + 2},$${b + 2},$${b + 3},$${b + 4},` +
        `($${b + 5}::timestamp AT TIME ZONE $${b + 6}),` +
        `$${b + 7},$${b + 8},$${b + 9},$${b + 9},$${b + 10},$4,$${b + 11},$${b + 12},` +
        `0,'POSTGRES',false,$1,$2,$3,NOW(),NOW())`
      );
      params.push(
        ids.event(),                          // _id
        ev.tipo,                              // tipo (= evento)
        ev.fecha,                             // fecha
        ev.horaInicio,                        // hora
        `${ev.fecha} ${ev.horaInicio}:00`,    // dia local (→ AT TIME ZONE)
        tz,                                   // authorTz
        advisor,                              // advisor (GUIAS._id)
        curso.tipoCurso,                      // nivel (= 'IMPULSA')
        titulo,                               // titulo (= tituloONivel)
        nombreEventoDe(ev, curso),            // nombreEvento
        limite,                               // limiteUsuarios
        curso._id,                            // cursoCampaignId
      );
    });
    await query(`INSERT INTO "CALENDARIO" (${cols}) VALUES ${rows.join(', ')}`, params);
    // Asigna módulo/lección a cada evento (por tipo, en secuencia) para que la
    // pestaña Material y el display los resuelvan. Best-effort.
    await asignarLeccionesImpulsa(curso._id).catch((e) => console.warn('asignarLeccionesImpulsa:', e?.message));
  }

  // Persistir la config (upsert por curso).
  await query(
    `INSERT INTO "IMPULSA_CURSO_CONFIG"
       ("_id","cursoCampaignId","authorTz","inicioSesiones","finSesiones","festivos","entrenamientos","evaluaciones","resumen","materializado","creadoPor","_createdDate","_updatedDate")
     VALUES ($1,$2,$3,$4::date,$5::date,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,true,$10,NOW(),NOW())
     ON CONFLICT ("cursoCampaignId") DO UPDATE SET
       "authorTz"=EXCLUDED."authorTz", "inicioSesiones"=EXCLUDED."inicioSesiones",
       "finSesiones"=EXCLUDED."finSesiones", "festivos"=EXCLUDED."festivos",
       "entrenamientos"=EXCLUDED."entrenamientos", "evaluaciones"=EXCLUDED."evaluaciones",
       "resumen"=EXCLUDED."resumen", "materializado"=true, "_updatedDate"=NOW()`,
    [ids.audit(), curso._id, tz, cfg.inicioSesiones, cfg.finSesiones,
     JSON.stringify(cfg.festivos || []), JSON.stringify(cfg.entrenamientos || []),
     JSON.stringify(cfg.evaluaciones || []), JSON.stringify(calc.resumen), actor || null],
  );

  return { count: eventos.length, resumen: calc.resumen };
}
