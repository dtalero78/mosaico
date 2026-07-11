/**
 * Bloqueo Contrato Service
 *
 * Permite bloquear manualmente titular + beneficiarios de un contrato vencido.
 * Respeta extensiones individuales de beneficiarios: si un beneficiario tiene
 * `finalContrato` distinto al del titular Y mayor a hoy, NO se bloquea.
 *
 * Reglas:
 *   1. Buscar titular por `contrato`. Si no existe → NotFoundError.
 *   2. Validar titular.finalContrato < hoy. Si no, devolver inconsistencia.
 *   3. Para cada beneficiario del mismo contrato:
 *      - Si `finalContrato` coincide con titular → BLOQUEAR.
 *      - Si difiere y `finalContrato < hoy` → BLOQUEAR (extensión vencida).
 *      - Si difiere y `finalContrato >= hoy` → SKIP (extensión vigente).
 *   4. Ejecutar bloqueo: PEOPLE + ACADEMICA + USUARIOS_ROLES sincronizados.
 */
import 'server-only';
import { queryMany, query } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';

export interface PersonToBlock {
  _id: string;
  nombre: string;
  numeroId: string | null;
  finalContrato: string | null; // ISO date YYYY-MM-DD
  role: 'TITULAR' | 'BENEFICIARIO';
  reason: 'titular_expired' | 'matches_titular' | 'own_expired' | 'already_blocked';
}

export interface PersonToSkip {
  _id: string;
  nombre: string;
  numeroId: string | null;
  finalContrato: string | null;
  role: 'BENEFICIARIO';
  reason: 'extension_active';
}

export interface LookupResultValid {
  valid: true;
  contrato: string;
  titular: { _id: string; nombre: string; numeroId: string | null; finalContrato: string | null; estadoInactivo: boolean };
  toBlock: PersonToBlock[];
  toSkip: PersonToSkip[];
}

export interface LookupResultInvalid {
  valid: false;
  reason: 'titular_no_vencido' | 'sin_finalcontrato';
  message: string;
  titular: { _id: string; nombre: string; numeroId: string | null; finalContrato: string | null };
}

export type LookupResult = LookupResultValid | LookupResultInvalid;

function isExpired(finalContrato: string | null): boolean {
  if (!finalContrato) return false;
  // Comparación estricta: finalContrato < hoy (UTC date-only).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const final = new Date(finalContrato);
  final.setUTCHours(0, 0, 0, 0);
  return final.getTime() < today.getTime();
}

function fullName(p: { primerNombre?: string | null; primerApellido?: string | null }): string {
  return `${p.primerNombre || ''} ${p.primerApellido || ''}`.trim() || '(sin nombre)';
}

function dateOnly(d: any): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/**
 * Busca titular + beneficiarios por número de contrato y evalúa qué se bloquea.
 */
export async function lookupByContrato(contrato: string): Promise<LookupResult> {
  const trimmed = (contrato || '').trim();
  if (!trimmed) {
    throw new ValidationError('Número de contrato es obligatorio');
  }

  // 1. Buscar titular del contrato
  const titulares = await queryMany(
    `SELECT "_id", "primerNombre", "primerApellido", "numeroId",
            "finalContrato", "estadoInactivo", "email"
     FROM "PEOPLE"
     WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
     LIMIT 1`,
    [trimmed]
  );

  if (titulares.length === 0) {
    throw new NotFoundError('Titular', `contrato ${trimmed}`);
  }

  const titular = titulares[0];
  const titularFinal = dateOnly(titular.finalContrato);

  // 2. Validar titular.finalContrato
  if (!titularFinal) {
    return {
      valid: false,
      reason: 'sin_finalcontrato',
      message: `El titular ${fullName(titular)} no tiene fecha de finalización registrada. No se puede evaluar el bloqueo.`,
      titular: {
        _id: titular._id,
        nombre: fullName(titular),
        numeroId: titular.numeroId,
        finalContrato: null,
      },
    };
  }

  if (!isExpired(titularFinal)) {
    return {
      valid: false,
      reason: 'titular_no_vencido',
      message: `Inconsistencia: el contrato del titular ${fullName(titular)} vence el ${titularFinal} y todavía está vigente. No se puede bloquear.`,
      titular: {
        _id: titular._id,
        nombre: fullName(titular),
        numeroId: titular.numeroId,
        finalContrato: titularFinal,
      },
    };
  }

  // 3. Buscar beneficiarios del mismo contrato
  const beneficiarios = await queryMany(
    `SELECT "_id", "primerNombre", "primerApellido", "numeroId",
            "finalContrato", "estadoInactivo", "email"
     FROM "PEOPLE"
     WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
     ORDER BY "primerApellido" NULLS LAST, "primerNombre" NULLS LAST`,
    [trimmed]
  );

  const toBlock: PersonToBlock[] = [];
  const toSkip: PersonToSkip[] = [];

  // Titular siempre va a bloqueo (ya validamos que está vencido)
  toBlock.push({
    _id: titular._id,
    nombre: fullName(titular),
    numeroId: titular.numeroId,
    finalContrato: titularFinal,
    role: 'TITULAR',
    reason: titular.estadoInactivo === true ? 'already_blocked' : 'titular_expired',
  });

  // Evaluar cada beneficiario
  for (const b of beneficiarios) {
    const bFinal = dateOnly(b.finalContrato);

    // Beneficiario sin finalContrato → tratarlo como "coincide con titular" (bloqueo)
    if (!bFinal) {
      toBlock.push({
        _id: b._id,
        nombre: fullName(b),
        numeroId: b.numeroId,
        finalContrato: null,
        role: 'BENEFICIARIO',
        reason: b.estadoInactivo === true ? 'already_blocked' : 'matches_titular',
      });
      continue;
    }

    // Si coincide con titular → bloqueo
    if (bFinal === titularFinal) {
      toBlock.push({
        _id: b._id,
        nombre: fullName(b),
        numeroId: b.numeroId,
        finalContrato: bFinal,
        role: 'BENEFICIARIO',
        reason: b.estadoInactivo === true ? 'already_blocked' : 'matches_titular',
      });
      continue;
    }

    // Difiere — chequear si extensión vigente
    if (isExpired(bFinal)) {
      toBlock.push({
        _id: b._id,
        nombre: fullName(b),
        numeroId: b.numeroId,
        finalContrato: bFinal,
        role: 'BENEFICIARIO',
        reason: b.estadoInactivo === true ? 'already_blocked' : 'own_expired',
      });
    } else {
      toSkip.push({
        _id: b._id,
        nombre: fullName(b),
        numeroId: b.numeroId,
        finalContrato: bFinal,
        role: 'BENEFICIARIO',
        reason: 'extension_active',
      });
    }
  }

  return {
    valid: true,
    contrato: trimmed,
    titular: {
      _id: titular._id,
      nombre: fullName(titular),
      numeroId: titular.numeroId,
      finalContrato: titularFinal,
      estadoInactivo: titular.estadoInactivo === true,
    },
    toBlock,
    toSkip,
  };
}

export interface BloqueoExecuteResult {
  blocked: number;
  details: Array<{
    _id: string;
    nombre: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Ejecuta el bloqueo en PEOPLE + ACADEMICA + USUARIOS_ROLES (sincronizado).
 *
 * NOTA: los `personIds` deben venir del lookup previo. Esta función NO re-evalúa
 * la regla de vencimiento — confía en que el caller (route handler) hizo el
 * lookup antes y solo está confirmando.
 */
export async function executeBloqueo(personIds: string[]): Promise<BloqueoExecuteResult> {
  if (!Array.isArray(personIds) || personIds.length === 0) {
    throw new ValidationError('personIds es obligatorio y no puede estar vacío');
  }

  const personas = await queryMany(
    `SELECT "_id", "primerNombre", "primerApellido", "numeroId", "email", "userLogin"
     FROM "PEOPLE"
     WHERE "_id" = ANY($1::text[])`,
    [personIds]
  );

  const details: BloqueoExecuteResult['details'] = [];

  for (const p of personas) {
    try {
      // PEOPLE — bloqueo por vencimiento.
      // Política unificada (mayo 2026): sólo escribe `estado='FINALIZADA'`
      // + `estadoInactivo=true`. El campo `aprobacion` NO se toca (refleja
      // la decisión comercial original — Aprobado/Pendiente/Retractado/etc).
      await query(
        `UPDATE "PEOPLE"
         SET "estadoInactivo" = true,
             "estado" = 'FINALIZADA',
             "_updatedDate" = NOW()
         WHERE "_id" = $1`,
        [p._id]
      );

      // ACADEMICA / USUARIOS_ROLES son una sola fila por persona física.
      // Si la misma persona figura también como BENEFICIARIO activo (extensión
      // vigente, otro contrato, etc.), NO debemos inactivar sus tablas compartidas.
      // Verificamos antes de cada UPDATE.
      if (p.numeroId) {
        const otro = await queryMany(
          `SELECT 1 FROM "PEOPLE"
           WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
             AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)
             AND "_id" <> $2
           LIMIT 1`,
          [p.numeroId, p._id]
        );
        if (otro.length === 0) {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = true, "_updatedDate" = NOW()
             WHERE "numeroId" = $1`,
            [p.numeroId]
          ).catch(() => {});
        }
      }

      // Bloquear el ACCESO (login). En MOSAICO el login es por `userLogin` (los
      // hermanos comparten el email del apoderado), así que bloqueamos la cuenta
      // POR userLogin — preciso por alumno, sin afectar a los demás. Fallback a
      // email (legacy) con guarda de email compartido para cuentas sin userLogin.
      if (p.userLogin) {
        await query(
          `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
           WHERE "userLogin" = $1`,
          [p.userLogin]
        ).catch(() => {});
      } else if (p.email) {
        const otroLogin = await queryMany(
          `SELECT 1 FROM "PEOPLE"
           WHERE LOWER("email") = LOWER($1) AND "tipoUsuario" = 'BENEFICIARIO'
             AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)
             AND "_id" <> $2
           LIMIT 1`,
          [p.email, p._id]
        );
        if (otroLogin.length === 0) {
          await query(
            `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
             WHERE LOWER("email") = LOWER($1)`,
            [p.email]
          ).catch(() => {});
        }
      }

      details.push({
        _id: p._id,
        nombre: fullName(p),
        success: true,
      });
    } catch (e) {
      details.push({
        _id: p._id,
        nombre: fullName(p),
        success: false,
        error: e instanceof Error ? e.message : 'Error desconocido',
      });
    }
  }

  return {
    blocked: details.filter(d => d.success).length,
    details,
  };
}
