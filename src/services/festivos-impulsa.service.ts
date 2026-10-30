import 'server-only';
import { query, queryMany, withTransaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { parseHorario } from '@/lib/cursos-campaign';
import { esAprobadoSql } from '@/lib/estados';
import { bookingConRegistroSql } from '@/lib/booking-registro';
import { asignarLeccionesImpulsa } from './impulsa-calendario.service';
import { generarBookingsBeneficiario } from './cursos-campaign-eventos.service';

/**
 * Festivos de IMPULSA — panel aparte del de MOSAICO.
 *
 * IMPULSA no usa el motor de calendario de MOSAICO (su calendario son sesiones
 * L-M-V más entrenamientos y evaluaciones en fechas fijas): regenerarlo se los
 * borraría. Por eso declarar un día sin clase aquí NO regenera el curso: quita
 * SOLO la clase (SESSION) de ese día y la corre al final de las sesiones, al
 * siguiente día de clase libre. Entrenamientos, evaluaciones y la asistencia ya
 * registrada no se tocan; si la clase del día tiene registro, ese curso se salta.
 */

export interface ResultadoImpulsa {
  cursoId: string;
  curso: string;
  estado: 'MOVIDA' | 'SIN_CLASE' | 'CON_REGISTRO' | 'SIN_DIA_LIBRE' | 'ERROR';
  nuevaFecha?: string;
  detalle?: string;
}

/** Cursos IMPULSA activos y no terminados, para elegir en el panel. */
export async function cursosImpulsaParaElegir() {
  return queryMany<{ _id: string; campaign: string; tipoCurso: string; salon: string | null; horarioCurso: string | null }>(
    `SELECT "_id","campaign","tipoCurso","salon","horarioCurso" FROM "CURSOS_CAMPAIGN"
      WHERE "activa" IS NOT FALSE AND UPPER("tipoCurso") = 'IMPULSA' AND "finalCurso" >= CURRENT_DATE - INTERVAL '60 days'
      ORDER BY "campaign" DESC, "salon"`
  ).catch(() => []);
}

const sumarDias = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface Movimiento { cursoId: string; desde: string; hacia: string }

type CursoRow = { _id: string; campaign: string; tipoCurso: string; salon: string | null; horarioCurso: string | null };

async function cursoDe(cursoId: string): Promise<CursoRow | null> {
  const cr = await query<any>(
    `SELECT "_id","campaign","tipoCurso","salon","horarioCurso" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`, [cursoId]);
  const c = cr.rows[0];
  return c && String(c.tipoCurso).toUpperCase() === 'IMPULSA' ? c : null;
}

async function tzDe(cursoId: string): Promise<{ tz: string; festivos: Set<string> }> {
  const cfg = (await query<{ authorTz: string; festivos: any }>(
    `SELECT "authorTz","festivos" FROM "IMPULSA_CURSO_CONFIG" WHERE "cursoCampaignId" = $1`, [cursoId])).rows[0];
  return {
    tz: cfg?.authorTz || 'America/Santiago',
    festivos: new Set<string>((Array.isArray(cfg?.festivos) ? cfg!.festivos : []).map((x: any) => String(x).slice(0, 10))),
  };
}

/**
 * Traslada la(s) sesión(es) de un curso IMPULSA de la fecha `desde` a la fecha `hacia`:
 * copia el evento con la nueva fecha, borra el viejo y sus agendamientos, recorre las
 * lecciones y agenda a los alumnos. Rechaza si la clase tiene asistencia/registro.
 */
async function trasladar(curso: CursoRow, desde: string, hacia: string): Promise<{ estado: 'OK' | 'SIN_CLASE' | 'CON_REGISTRO'; detalle?: string }> {
  const evs = (await query<{ _id: string }>(
    `SELECT "_id" FROM "CALENDARIO" WHERE "cursoCampaignId" = $1 AND "fecha" = $2::date AND "tipo" = 'SESSION'`,
    [curso._id, desde])).rows;
  if (!evs.length) return { estado: 'SIN_CLASE', detalle: 'Ese día no tiene sesión.' };
  const evIds = evs.map((e) => e._id);

  const reg = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "ACADEMICA_BOOKINGS" b
      WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[])) AND ${bookingConRegistroSql('b')}`, [evIds]);
  if ((reg.rows[0]?.n || 0) > 0) {
    return { estado: 'CON_REGISTRO', detalle: 'La clase del ' + desde + ' ya tiene asistencia u otro registro; no se mueve.' };
  }
  const { tz } = await tzDe(curso._id);

  await withTransaction(async (client) => {
    for (const oldId of evIds) {
      await client.query(
        `INSERT INTO "CALENDARIO" ("_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","campaign","curso","salon","_createdDate","_updatedDate")
         SELECT $2,"tipo","evento",$3::date,"hora",(($4::text || ' ' || "hora" || ':00')::timestamp AT TIME ZONE $5),"advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId",0,"origen",false,"campaign","curso","salon",NOW(),NOW()
           FROM "CALENDARIO" WHERE "_id" = $1`,
        [oldId, ids.event(), hacia, hacia, tz]);
      await client.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = $1 OR "idEvento" = $1`, [oldId]);
      await client.query(`DELETE FROM "CALENDARIO" WHERE "_id" = $1`, [oldId]);
    }
    await client.query(
      `UPDATE "CURSOS_CAMPAIGN" SET "finalCurso" = GREATEST("finalCurso", $2::date) WHERE "_id" = $1`, [curso._id, hacia]);
  });

  // Lecciones recorridas y agendamientos de la clase nueva (idempotente).
  await asignarLeccionesImpulsa(curso._id).catch((e) => console.warn('asignarLeccionesImpulsa:', e?.message));
  const est = (await query<any>(
    `SELECT DISTINCT a."_id" AS acaid, a."numeroId", a."primerNombre", a."primerApellido", a."celular", a."plataforma"
       FROM "PEOPLE" p JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3 AND p."salon" IS NOT DISTINCT FROM $4
        AND ${esAprobadoSql('p."aprobacion"')} AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    [curso.campaign, curso.tipoCurso, curso.horarioCurso, curso.salon])).rows;
  for (const s of est) {
    await generarBookingsBeneficiario(s.acaid, {
      campaign: curso.campaign, tipoCurso: curso.tipoCurso, horarioCurso: curso.horarioCurso, salon: curso.salon,
      numeroId: s.numeroId, primerNombre: s.primerNombre, primerApellido: s.primerApellido,
      celular: s.celular, plataforma: s.plataforma,
    }, { soloFuturos: true });
  }
  return { estado: 'OK' };
}

async function moverClase(cursoId: string, fecha: string): Promise<ResultadoImpulsa> {
  const curso = await cursoDe(cursoId);
  if (!curso) return { cursoId, curso: cursoId, estado: 'ERROR', detalle: 'No es un curso IMPULSA.' };
  const base = { cursoId, curso: curso.campaign + ' ' + curso.tipoCurso + '/' + (curso.salon || '—') };

  const evIds = (await query<{ _id: string }>(
    `SELECT "_id" FROM "CALENDARIO" WHERE "cursoCampaignId" = $1 AND "fecha" = $2::date AND "tipo" = 'SESSION'`,
    [cursoId, fecha])).rows.map((r) => r._id);
  if (!evIds.length) return { ...base, estado: 'SIN_CLASE', detalle: 'Ese día no tiene sesión.' };

  // Días válidos del horario (L-M-V) y días que NO se pueden usar.
  const hor = parseHorario(curso.horarioCurso || '');
  if (!hor) return { ...base, estado: 'ERROR', detalle: 'El curso no tiene un horario legible.' };
  const { festivos: propios } = await tzDe(cursoId);
  const declarados = (await query<{ fecha: string }>(
    `SELECT "fecha"::text AS "fecha" FROM "FESTIVOS_PERSONALIZADOS"
      WHERE "alcance" = 'IMPULSA' AND "cursoIds" ? $1`, [cursoId])).rows.map((r) => String(r.fecha).slice(0, 10));
  declarados.forEach((d) => propios.add(d));
  const fijos = new Set((await query<{ fecha: string }>(
    `SELECT DISTINCT "fecha"::text AS "fecha" FROM "CALENDARIO"
      WHERE "cursoCampaignId" = $1 AND "tipo" IN ('ENTRENAMIENTO','EVALUACION')`, [cursoId])).rows.map((r) => String(r.fecha).slice(0, 10)));
  const conSesion = new Set((await query<{ fecha: string }>(
    `SELECT DISTINCT "fecha"::text AS "fecha" FROM "CALENDARIO"
      WHERE "cursoCampaignId" = $1 AND "tipo" = 'SESSION' AND "_id" <> ALL($2::text[])`, [cursoId, evIds])).rows.map((r) => String(r.fecha).slice(0, 10)));
  const ult = (await query<{ f: string | null }>(
    `SELECT MAX("fecha")::text AS "f" FROM "CALENDARIO"
      WHERE "cursoCampaignId" = $1 AND "tipo" = 'SESSION' AND "_id" <> ALL($2::text[])`, [cursoId, evIds])).rows[0]?.f;
  let nueva: string | null = null;
  let cur = String(ult || fecha).slice(0, 10);
  for (let i = 0; i < 90 && !nueva; i++) {
    cur = sumarDias(cur, 1);
    const dow = new Date(cur + 'T00:00:00Z').getUTCDay();
    if (hor.dias.includes(dow) && !propios.has(cur) && !fijos.has(cur) && !conSesion.has(cur) && cur !== fecha) nueva = cur;
  }
  if (!nueva) return { ...base, estado: 'SIN_DIA_LIBRE', detalle: 'No se encontró un día libre para correr la clase.' };

  const t = await trasladar(curso, fecha, nueva);
  if (t.estado === 'CON_REGISTRO') return { ...base, estado: 'CON_REGISTRO', detalle: t.detalle };
  if (t.estado === 'SIN_CLASE') return { ...base, estado: 'SIN_CLASE', detalle: t.detalle };
  return { ...base, estado: 'MOVIDA', nuevaFecha: nueva };
}

/**
 * Aplica el día sin clase a cada curso IMPULSA indicado (uno por uno, sin regenerar)
 * y guarda en el festivo qué clase se corrió adónde, para poder deshacerlo.
 */
export async function aplicarFestivoImpulsa(festivoId: string, fecha: string, cursoIds: string[]): Promise<ResultadoImpulsa[]> {
  const out: ResultadoImpulsa[] = [];
  const movs: Movimiento[] = [];
  for (const id of cursoIds) {
    try {
      const r = await moverClase(id, fecha);
      out.push(r);
      if (r.estado === 'MOVIDA' && r.nuevaFecha) movs.push({ cursoId: id, desde: fecha, hacia: r.nuevaFecha });
    } catch (e: any) { out.push({ cursoId: id, curso: id, estado: 'ERROR', detalle: e?.message || String(e) }); }
  }
  await query(`UPDATE "FESTIVOS_PERSONALIZADOS" SET "movimientos" = $2::jsonb WHERE "_id" = $1`, [festivoId, JSON.stringify(movs)]);
  return out;
}

/**
 * Deshace un festivo IMPULSA: devuelve cada clase corrida a su día original. Si la
 * clase corrida ya tiene asistencia/registro, o el día original ya tiene sesión,
 * no se mueve y se informa (queda para ajuste manual en Crear IMPULSA).
 */
export async function restablecerFestivoImpulsa(movimientos: Movimiento[]): Promise<ResultadoImpulsa[]> {
  const out: ResultadoImpulsa[] = [];
  for (const m of movimientos || []) {
    const curso = await cursoDe(m.cursoId).catch(() => null);
    const nombre = curso ? curso.campaign + ' ' + curso.tipoCurso + '/' + (curso.salon || '—') : m.cursoId;
    if (!curso) { out.push({ cursoId: m.cursoId, curso: nombre, estado: 'ERROR', detalle: 'El curso ya no existe.' }); continue; }
    try {
      const ocupado = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "CALENDARIO" WHERE "cursoCampaignId" = $1 AND "fecha" = $2::date AND "tipo" = 'SESSION'`,
        [m.cursoId, m.desde]);
      if ((ocupado.rows[0]?.n || 0) > 0) {
        out.push({ cursoId: m.cursoId, curso: nombre, estado: 'ERROR', detalle: 'El ' + m.desde + ' ya tiene una sesión; no se devolvió la clase.' });
        continue;
      }
      const t = await trasladar(curso, m.hacia, m.desde);
      out.push(t.estado === 'OK'
        ? { cursoId: m.cursoId, curso: nombre, estado: 'MOVIDA', nuevaFecha: m.desde }
        : { cursoId: m.cursoId, curso: nombre, estado: t.estado, detalle: t.detalle });
    } catch (e: any) { out.push({ cursoId: m.cursoId, curso: nombre, estado: 'ERROR', detalle: e?.message || String(e) }); }
  }
  return out;
}
