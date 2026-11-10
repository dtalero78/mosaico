import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

/**
 * Bitácora de movimientos del contrato (tabla CONTRATO_EVENTOS, solo INSERT; la crea
 * scripts/create-contrato-eventos.js). Solo para lo que no queda escrito en otra fuente:
 * el Seguimiento (seguimiento-contrato.service.ts) ya lee aprobaciones, pagos, firma,
 * OnHold, extensiones, etc. de sus propias tablas.
 *
 * BEST-EFFORT: si falla se loguea y la operación de negocio sigue.
 * Con `personaId` basta: el titular, contrato, nombre y tipo se resuelven de PEOPLE.
 */

export type CategoriaEvento =
  | 'MATRICULA' | 'DOCUMENTOS' | 'FIRMA' | 'APROBACION' | 'BENEFICIARIOS'
  | 'PAGOS' | 'RECAUDOS' | 'VIGENCIA' | 'ACADEMICO' | 'CUPO' | 'KIDS' | 'COMENTARIO';

export interface EventoContrato {
  personaId: string;
  categoria: CategoriaEvento;
  accion: string;
  detalle?: string | null;
  datos?: Record<string, any> | null;
  /** Sesión de NextAuth; o `actor` (email/nombre) cuando lo hace el sistema. */
  session?: any;
  actor?: string | null;
  /** Si la persona ya se borró (p. ej. beneficiario eliminado), pasar sus datos. */
  persona?: { titularId?: string | null; contrato?: string | null; nombre?: string | null; tipoUsuario?: string | null };
  /** true = si falla se lanza el error (p. ej. un comentario escrito a mano); por defecto es best-effort. */
  estricto?: boolean;
}

export async function registrarEventoContrato(e: EventoContrato): Promise<void> {
  try {
    let p = e.persona;
    if (!p) {
      const r = await queryOne<any>(
        `SELECT "_id","titularId","contrato","tipoUsuario","primerNombre","primerApellido" FROM "PEOPLE" WHERE "_id"=$1`,
        [e.personaId]);
      p = r ? {
        titularId: r.tipoUsuario === 'TITULAR' ? r._id : r.titularId,
        contrato: r.contrato,
        nombre: [r.primerNombre, r.primerApellido].filter(Boolean).join(' ').trim() || null,
        tipoUsuario: r.tipoUsuario,
      } : {};
    }
    const u = e.session?.user as any;
    await query(
      `INSERT INTO "CONTRATO_EVENTOS" ("_id","titularId","contrato","personaId","personaNombre","tipoUsuario",
         "categoria","accion","detalle","datos","usuarioEmail","usuarioNombre","usuarioRol")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [generateId('cev'), p.titularId ?? null, p.contrato ?? null, e.personaId, p.nombre ?? null, p.tipoUsuario ?? null,
       e.categoria, e.accion, (e.detalle || '').trim() || null, e.datos ? JSON.stringify(e.datos) : null,
       u?.email ?? e.actor ?? null, u?.name ?? null, u?.role ?? null]);
  } catch (err: any) {
    if (e.estricto) throw err;
    console.warn('⚠️ [contrato-eventos] no se pudo registrar:', err?.message || err);
  }
}

/**
 * PEOPLE._id del beneficiario dueño de una ficha (acepta el _id de ACADEMICA o ya uno de PEOPLE).
 * Misma prioridad que findBeneficiarioByNumeroId: la fila ligada (usuarioId) y luego la más reciente.
 */
export async function personaDeFichaAcademica(id: string): Promise<string | null> {
  try {
    const r = await queryOne<{ _id: string }>(
      `SELECT "_id" FROM "PEOPLE" WHERE "_id" = $1
       UNION ALL
       SELECT * FROM (
         SELECT p."_id" FROM "ACADEMICA" a
           JOIN "PEOPLE" p ON p."_id" = a."usuarioId" OR (p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO')
          WHERE a."_id" = $1
          ORDER BY (p."_id" = a."usuarioId") DESC, p."_createdDate" DESC
          LIMIT 1) x
       LIMIT 1`, [id]);
    return r?._id ?? null;
  } catch { return null; }
}

/** Campos cambiados entre dos objetos (solo las claves de `nuevo`), para `datos.cambios`. */
export function diffCampos(antes: Record<string, any> | null | undefined, nuevo: Record<string, any>, ignorar: string[] = []) {
  const out: Record<string, { antes: any; despues: any }> = {};
  for (const [k, v] of Object.entries(nuevo || {})) {
    if (ignorar.includes(k) || k.startsWith('_')) continue;
    const a = antes?.[k];
    const norm = (x: any) => (x === undefined || x === '' ? null : typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x));
    if (norm(a) !== norm(v)) out[k] = { antes: a ?? null, despues: v ?? null };
  }
  return out;
}
