import 'server-only';
import { query, queryMany, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { ValidationError } from '@/lib/errors';
import { tienePermiso } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { esRolGuia } from '@/services/guia-sesion.service';
import {
  type TipoAutorizacion, type ReporteRef,
  refReporte, reporteRefValida,
  sesionVencida, eventoAdminVencido, reporteVencido,
  MAX_AUTORIZACIONES_POR_LOTE,
} from '@/lib/autorizacion-gestion';

/**
 * Autorizaciones de Coordinación para que el guía gestione lo que se le venció
 * (columna "Autoriza" de Procesos sin gestión). La regla y las llaves viven en
 * `lib/autorizacion-gestion`; aquí está la base de datos.
 *
 * ⚠ Las LECTURAS toleran que la tabla aún no exista (devuelven "sin autorizar"):
 * si el código se despliega antes que la migración, el guía queda como estaba
 * —sin poder gestionar lo vencido— en vez de que se caigan las pantallas.
 */

/**
 * ¿Puede esta sesión marcar la casilla "Autoriza"?
 *
 * Hace falta el permiso propio y NO ser guía: que el guía se autorizara a sí
 * mismo dejaría la casilla sin sentido, aunque alguien le marcara el permiso por
 * error. Lo usan las listas (para pintar la casilla) y el endpoint que escribe.
 */
export async function puedeAutorizarGestion(session: any): Promise<boolean> {
  if (esRolGuia(session)) return false;
  return tienePermiso(session, AcademicoPermission.PROCESOS_SIN_GESTION_AUTORIZAR);
}

export interface AutorizacionInfo {
  autorizadoPor: string;
  autorizadoPorNombre: string | null;
  autorizadoEn: string;
}

const aInfo = (r: any): AutorizacionInfo => ({
  autorizadoPor: r.autorizadoPor,
  autorizadoPorNombre: r.autorizadoPorNombre ?? null,
  autorizadoEn: r.autorizadoEn instanceof Date ? r.autorizadoEn.toISOString() : String(r.autorizadoEn),
});

/** La autorización VIGENTE de un proceso, o null. */
export async function autorizacionDe(tipo: TipoAutorizacion, refId: string): Promise<AutorizacionInfo | null> {
  if (!refId) return null;
  const r = await queryOne<any>(
    `SELECT "autorizadoPor","autorizadoPorNombre","autorizadoEn"
       FROM "GESTION_AUTORIZACIONES"
      WHERE "tipo" = $1 AND "refId" = $2 AND "activa" = true`,
    [tipo, refId],
  ).catch(() => null);
  return r ? aInfo(r) : null;
}

export async function estaAutorizado(tipo: TipoAutorizacion, refId: string): Promise<boolean> {
  return (await autorizacionDe(tipo, refId)) !== null;
}

/** Autorizaciones vigentes de un lote (para pintar las listas en una sola consulta). */
export async function autorizacionesDe(
  tipo: TipoAutorizacion, refIds: string[],
): Promise<Map<string, AutorizacionInfo>> {
  const out = new Map<string, AutorizacionInfo>();
  const ids = Array.from(new Set(refIds.filter(Boolean)));
  if (!ids.length) return out;
  const rows = await queryMany<any>(
    `SELECT "refId","autorizadoPor","autorizadoPorNombre","autorizadoEn"
       FROM "GESTION_AUTORIZACIONES"
      WHERE "tipo" = $1 AND "refId" = ANY($2::text[]) AND "activa" = true`,
    [tipo, ids],
  ).catch(() => [] as any[]);
  for (const r of rows) out.set(r.refId, aInfo(r));
  return out;
}

/**
 * Deja constancia de que el guía cerró el proceso con esa autorización. No la
 * desactiva: el proceso ya salió de la lista, y la fila queda como historia.
 * Best-effort — el cierre ya se hizo; un fallo al anotarlo no lo deshace.
 */
export async function marcarAutorizacionUsada(tipo: TipoAutorizacion, refId: string, email: string): Promise<void> {
  await query(
    `UPDATE "GESTION_AUTORIZACIONES"
        SET "usadaPor" = $3, "usadaEn" = NOW(), "_updatedDate" = NOW()
      WHERE "tipo" = $1 AND "refId" = $2 AND "activa" = true`,
    [tipo, refId, email],
  ).catch(err => console.warn('[autorizacion-gestion] no se pudo marcar como usada:', err?.message));
}

// ── Escritura ────────────────────────────────────────────────────────────────

export interface Omitido { refId: string; motivo: string }

export interface ResultadoAutorizar {
  /** Filas que cambiaron de estado con esta llamada. */
  aplicados: number;
  /** Ya estaban como se pidió (autorizadas / sin autorizar). */
  sinCambio: number;
  /** No se tocaron, con el motivo (ya gestionado, aún en plazo, no existe…). */
  omitidos: Omitido[];
}

interface Candidato { refId: string; guiaId: string | null }

/** Sesiones que se PUEDEN autorizar: existen, siguen sin registrar y ya vencieron. */
async function candidatosSesion(refIds: string[]): Promise<{ ok: Candidato[]; omitidos: Omitido[] }> {
  const rows = await queryMany<any>(
    `SELECT "_id","dia","advisor","sesionCerrada" FROM "CALENDARIO" WHERE "_id" = ANY($1::text[])`,
    [refIds],
  );
  const porId = new Map(rows.map(r => [r._id, r]));
  const ok: Candidato[] = []; const omitidos: Omitido[] = [];
  for (const refId of refIds) {
    const r = porId.get(refId);
    if (!r) omitidos.push({ refId, motivo: 'La sesión ya no existe.' });
    else if (r.sesionCerrada === true) omitidos.push({ refId, motivo: 'La sesión ya está registrada.' });
    else if (!sesionVencida(r.dia)) omitidos.push({ refId, motivo: 'Aún está dentro del plazo del guía: no necesita autorización.' });
    else ok.push({ refId, guiaId: r.advisor || null });
  }
  return { ok, omitidos };
}

async function candidatosEventoAdmin(refIds: string[]): Promise<{ ok: Candidato[]; omitidos: Omitido[] }> {
  const rows = await queryMany<any>(
    `SELECT "_id","fechaInicio","horas","advisorId","registrado" FROM "ADMIN_EVENTS" WHERE "_id" = ANY($1::text[])`,
    [refIds],
  );
  const porId = new Map(rows.map(r => [r._id, r]));
  const ok: Candidato[] = []; const omitidos: Omitido[] = [];
  for (const refId of refIds) {
    const r = porId.get(refId);
    if (!r) omitidos.push({ refId, motivo: 'El evento ya no existe.' });
    else if (r.registrado === true) omitidos.push({ refId, motivo: 'El evento ya está registrado.' });
    else if (!eventoAdminVencido(r.fechaInicio, Number(r.horas))) omitidos.push({ refId, motivo: 'Aún está dentro del plazo del guía: no necesita autorización.' });
    else ok.push({ refId, guiaId: r.advisorId || null });
  }
  return { ok, omitidos };
}

async function candidatosReporte(items: ReporteRef[]): Promise<{ ok: Candidato[]; omitidos: Omitido[] }> {
  const campaigns = Array.from(new Set(items.map(i => i.campaign.trim())));
  const semanas = Array.from(new Set(items.map(i => i.semanaInicio.slice(0, 10))));
  const [cursos, cierres] = await Promise.all([
    queryMany<any>(
      `SELECT "campaign","tipoCurso","salon","guia" FROM "CURSOS_CAMPAIGN" WHERE "campaign" = ANY($1::text[])`,
      [campaigns],
    ),
    queryMany<any>(
      `SELECT "campaign","curso","salon","semanaInicio"::text AS "semanaInicio"
         FROM "REPORTE_ACADEMICO_CIERRE"
        WHERE "semanaInicio" = ANY($1::date[]) AND "estado" IN ('CERRADO_GUIA','DEFINITIVO')`,
      [semanas],
    ),
  ]);
  const clave3 = (c: string, t: string, s: string) => `${c}|${t}|${s}`;
  const guiaDeCurso = new Map<string, string | null>();
  for (const c of cursos) {
    const k = clave3(String(c.campaign).trim(), String(c.tipoCurso).trim(), String(c.salon ?? '').trim());
    if (!guiaDeCurso.has(k) || (!guiaDeCurso.get(k) && c.guia)) guiaDeCurso.set(k, c.guia || null);
  }
  const cerrados = new Set(cierres.map(c => refReporte(c)));

  const ok: Candidato[] = []; const omitidos: Omitido[] = [];
  for (const it of items) {
    const refId = refReporte(it);
    const k = clave3(it.campaign.trim(), it.curso.trim(), it.salon.trim());
    if (it.curso.trim().toUpperCase() === 'IMPULSA') omitidos.push({ refId, motivo: 'IMPULSA no usa el Reporte Académico.' });
    else if (!guiaDeCurso.has(k)) omitidos.push({ refId, motivo: 'El salón no existe en esa campaña.' });
    else if (cerrados.has(refId)) omitidos.push({ refId, motivo: 'El informe de esa semana ya está cerrado.' });
    else if (!reporteVencido(it.semanaInicio)) omitidos.push({ refId, motivo: 'La semana aún no termina: no necesita autorización.' });
    else ok.push({ refId, guiaId: guiaDeCurso.get(k) ?? null });
  }
  return { ok, omitidos };
}

/**
 * Marca o desmarca la autorización de un lote de procesos.
 *
 * Al AUTORIZAR se valida cada uno contra la base —que exista, que siga pendiente
 * y que de verdad esté vencido—; lo que no cumple se devuelve en `omitidos` sin
 * abortar al resto: en un lote de decenas, uno que el guía cerró mientras tanto
 * no debe tumbar a los demás. Al DESMARCAR no hay nada que validar.
 */
export async function aplicarAutorizaciones(input: {
  tipo: TipoAutorizacion;
  autorizar: boolean;
  /** SESION / EVENTO_ADMIN: los ids. */
  refIds?: string[];
  /** REPORTE: la cuaterna de cada informe. */
  items?: Partial<ReporteRef>[];
  actor: { email: string; nombre?: string | null };
}): Promise<ResultadoAutorizar> {
  const { tipo, autorizar, actor } = input;

  let refIds: string[] = [];
  let reportes: ReporteRef[] = [];
  if (tipo === 'REPORTE') {
    const crudos = Array.isArray(input.items) ? input.items : [];
    if (crudos.some(i => !reporteRefValida(i))) {
      throw new ValidationError('Cada informe necesita campaña, curso, salón y semana (YYYY-MM-DD).');
    }
    const vistos = new Set<string>();
    for (const i of crudos as ReporteRef[]) {
      const limpio = { campaign: i.campaign.trim(), curso: i.curso.trim(), salon: i.salon.trim(), semanaInicio: i.semanaInicio.slice(0, 10) };
      const k = refReporte(limpio);
      if (!vistos.has(k)) { vistos.add(k); reportes.push(limpio); }
    }
    refIds = reportes.map(refReporte);
  } else {
    refIds = Array.from(new Set((input.refIds || []).map(v => String(v || '').trim()).filter(Boolean)));
  }

  if (!refIds.length) throw new ValidationError('No hay nada seleccionado.');
  if (refIds.length > MAX_AUTORIZACIONES_POR_LOTE) {
    throw new ValidationError(`Máximo ${MAX_AUTORIZACIONES_POR_LOTE} por operación.`);
  }

  if (!autorizar) {
    const r = await query(
      `UPDATE "GESTION_AUTORIZACIONES"
          SET "activa" = false, "revocadoPor" = $3, "revocadoEn" = NOW(), "_updatedDate" = NOW()
        WHERE "tipo" = $1 AND "refId" = ANY($2::text[]) AND "activa" = true`,
      [tipo, refIds, actor.email],
    );
    const aplicados = r.rowCount ?? 0;
    return { aplicados, sinCambio: refIds.length - aplicados, omitidos: [] };
  }

  const { ok, omitidos } =
    tipo === 'SESION' ? await candidatosSesion(refIds)
      : tipo === 'EVENTO_ADMIN' ? await candidatosEventoAdmin(refIds)
        : await candidatosReporte(reportes);

  if (!ok.length) return { aplicados: 0, sinCambio: 0, omitidos };

  // Una sola sentencia para todo el lote. Si ya estaba autorizada no se toca
  // (se conserva quién la autorizó primero); si estaba desmarcada se reactiva
  // a nombre de quien la marca ahora.
  const r = await query(
    `INSERT INTO "GESTION_AUTORIZACIONES"
       ("_id","tipo","refId","guiaId","activa","autorizadoPor","autorizadoPorNombre","autorizadoEn")
     SELECT x.id, $1, x.ref, x.guia, true, $5, $6, NOW()
       FROM unnest($2::text[], $3::text[], $4::text[]) AS x(id, ref, guia)
     ON CONFLICT ("tipo","refId") DO UPDATE SET
       "activa" = true,
       "guiaId" = EXCLUDED."guiaId",
       "autorizadoPor" = EXCLUDED."autorizadoPor",
       "autorizadoPorNombre" = EXCLUDED."autorizadoPorNombre",
       "autorizadoEn" = NOW(),
       "revocadoPor" = NULL, "revocadoEn" = NULL,
       "usadaPor" = NULL, "usadaEn" = NULL,
       "_updatedDate" = NOW()
     WHERE "GESTION_AUTORIZACIONES"."activa" = false`,
    [
      tipo,
      ok.map(() => generateId('aut')),
      ok.map(c => c.refId),
      ok.map(c => c.guiaId),
      actor.email,
      actor.nombre || null,
    ],
  );
  const aplicados = r.rowCount ?? 0;
  return { aplicados, sinCambio: ok.length - aplicados, omitidos };
}
