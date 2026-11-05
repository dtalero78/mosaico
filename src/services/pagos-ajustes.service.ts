/**
 * Recaudos › Gestión › Ajustes
 *
 * Corrige una inscripción, un pago o una factura YA VALIDADOS (los pendientes se
 * editan desde Verificación). Cada ajuste:
 *   1. exige motivo (≥10 caracteres),
 *   2. actualiza sólo los campos permitidos para su tipo,
 *   3. recalcula los saldos del titular (recalcularSaldosTitular),
 *   4. deja auditoría inmutable en PAGOS_AJUSTES (antes/después + saldo),
 * todo en UNA transacción.
 *
 * Tipos: INSCRIPCION (cuota #0) · PAGO (cuotas #1..N) · FACTURA (pago ya facturado).
 *
 * Diferencias con LGS: el valor aplicado es pagado + descuento (rebaja sobre la
 * cuota) y la factura "ADMIN" sólo la puede poner quien tenga PAGOS_FACTURAR_ADMIN
 * (lo valida el endpoint). El número de cuota no admite abonos parciales: MOSAICO
 * aún no separa N° de pago de cuota aplicada.
 */
import 'server-only';
import { queryMany, transaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { FACTURA_ADMIN, esFacturaAdmin } from '@/lib/factura-admin';
import { recalcularSaldosTitular } from '@/lib/recalcular-saldos';
import { computePlataformaScope, getSessionPlataforma, buildPlataformaWhereSql } from '@/lib/recaudos-scope';

export type TipoAjuste = 'INSCRIPCION' | 'PAGO' | 'FACTURA';
export const TIPOS_AJUSTE: TipoAjuste[] = ['INSCRIPCION', 'PAGO', 'FACTURA'];

const CAMPOS: Record<TipoAjuste, string[]> = {
  INSCRIPCION: ['valorPagado', 'descuento', 'fechaPago', 'medioPago', 'banco', 'numeroReferencia'],
  PAGO:        ['numCuota', 'valorPagado', 'descuento', 'fechaPago', 'medioPago', 'banco', 'numeroReferencia'],
  FACTURA:     ['numeroFactura'],
};
const NUMERICOS = new Set(['valorPagado', 'descuento', 'numCuota']);

export interface SessionInfo { email: string | null; nombre: string | null; role: string }

function condicionTipo(tipo: TipoAjuste): string {
  if (tipo === 'INSCRIPCION') return `COALESCE(pt."numCuota", 0) = 0`;
  if (tipo === 'PAGO') return `COALESCE(pt."numCuota", 0) > 0`;
  return `COALESCE(TRIM(pt."numeroFactura"), '') <> ''`;
}

async function scopeSql(session: SessionInfo, paramIndex: number) {
  const scope = computePlataformaScope(session.role, await getSessionPlataforma(session.email));
  return buildPlataformaWhereSql(scope, 'p."plataforma"', paramIndex);
}

function normalizar(campo: string, valor: any): any {
  if (campo === 'numCuota') {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) throw new ValidationError('# Cuota debe ser un número entero de 1 en adelante');
    return n;
  }
  if (NUMERICOS.has(campo)) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${campo} debe ser un número mayor o igual a 0`);
    return Number(n.toFixed(2));
  }
  if (campo === 'fechaPago') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))) throw new ValidationError('fechaPago debe tener formato YYYY-MM-DD');
    return String(valor);
  }
  if (campo === 'numeroFactura') {
    const f = String(valor ?? '').trim();
    if (!f) throw new ValidationError('El número de factura es obligatorio');
    if (f.length > 40) throw new ValidationError('El número de factura es demasiado largo');
    return esFacturaAdmin(f) ? FACTURA_ADMIN : f;
  }
  const s = String(valor ?? '').trim();
  return s || null;
}

function comparable(campo: string, valor: any): any {
  if (valor === null || valor === undefined || valor === '') return null;
  if (NUMERICOS.has(campo)) return Number(valor);
  if (campo === 'fechaPago') return new Date(valor).toISOString().slice(0, 10);
  return String(valor).trim();
}

export const pagosAjustesService = {
  /** Pagos validados del tipo, filtrados por titular / documento / contrato. */
  async buscar(session: SessionInfo, tipo: TipoAjuste, q: string | null) {
    const params: any[] = [];
    let where = `pt."validado" = true AND ${condicionTipo(tipo)} AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`;
    const texto = (q || '').trim();
    if (texto) {
      params.push(`%${texto}%`);
      const i = params.length;
      where += ` AND (p."contrato" ILIKE $${i} OR p."numeroId" ILIKE $${i} OR pt."numeroFactura" ILIKE $${i}
        OR (COALESCE(p."primerNombre",'') || ' ' || COALESCE(p."primerApellido",'') || ' ' || COALESCE(p."segundoApellido",'')) ILIKE $${i})`;
    }
    const sc = await scopeSql(session, params.length + 1);
    params.push(...sc.params);
    return queryMany(
      `SELECT pt."_id", pt."idPeople", pt."numCuota", pt."fechaPago", pt."valorPagado", pt."descuento", pt."saldo",
              pt."medioPago", pt."banco", pt."numeroReferencia", pt."numeroFactura", pt."fechaValidacion", pt."validadoPor",
              p."contrato", p."numeroId", p."plataforma",
              TRIM(COALESCE(p."primerNombre",'') || ' ' || COALESCE(p."primerApellido",'') || ' ' || COALESCE(p."segundoApellido",'')) AS "titular",
              f."saldo" AS "saldoContrato", f."totalPlan"
         FROM "PAGOS_TITULARES" pt
         JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
         LEFT JOIN "FINANCIEROS" f ON f."contrato" = p."contrato"
        WHERE ${where}${sc.sql}
        ORDER BY pt."fechaValidacion" DESC NULLS LAST, pt."_createdDate" DESC
        LIMIT 100`,
      params,
    );
  },

  /** Aplica el ajuste, recalcula saldos y audita. */
  async ajustar(session: SessionInfo, pagoId: string, tipo: TipoAjuste, cambios: Record<string, any>, motivo: string) {
    if (!TIPOS_AJUSTE.includes(tipo)) throw new ValidationError('Tipo de ajuste inválido');
    if (!motivo || motivo.trim().length < 10) throw new ValidationError('El motivo es obligatorio (mínimo 10 caracteres)');

    return transaction(async (client) => {
      const pago = (await client.query(
        `SELECT pt.*, p."contrato" FROM "PAGOS_TITULARES" pt JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
          WHERE pt."_id" = $1 FOR UPDATE OF pt`, [pagoId])).rows[0];
      if (!pago) throw new NotFoundError('PAGOS_TITULARES', pagoId);
      if (!pago.validado) throw new ValidationError('Sólo se ajustan registros validados. Los pendientes se editan desde Verificación.');
      const cuota = pago.numCuota ?? 0;
      if (tipo === 'INSCRIPCION' && cuota !== 0) throw new ValidationError('El registro no es una inscripción (cuota #0)');
      if (tipo === 'PAGO' && cuota === 0) throw new ValidationError('El registro es una inscripción: ajústelo en la pestaña Inscripciones');
      if (tipo === 'FACTURA' && !String(pago.numeroFactura || '').trim()) throw new ValidationError('El registro aún no tiene factura (se factura desde la pestaña Facturación)');

      // El alcance por plataforma también aplica al escribir.
      const sc = await scopeSql(session, 2);
      if (sc.sql) {
        const ok = (await client.query(`SELECT 1 FROM "PEOPLE" p WHERE p."_id" = $1${sc.sql}`, [pago.idPeople, ...sc.params])).rowCount;
        if (!ok) throw new ValidationError('El contrato no pertenece a su plataforma');
      }

      const antes: Record<string, any> = {};
      const despues: Record<string, any> = {};
      for (const campo of CAMPOS[tipo]) {
        if (!(campo in (cambios || {}))) continue;
        const nuevo = normalizar(campo, cambios[campo]);
        if (comparable(campo, nuevo) === comparable(campo, pago[campo])) continue;
        antes[campo] = comparable(campo, pago[campo]);
        despues[campo] = comparable(campo, nuevo);
      }
      const campos = Object.keys(despues);
      if (!campos.length) throw new ValidationError('No hay cambios para aplicar');
      if ('numCuota' in despues && pago.contrato) {
        const fin = (await client.query(`SELECT "numeroCuotas" FROM "FINANCIEROS" WHERE "contrato" = $1 LIMIT 1`, [pago.contrato])).rows[0];
        const total = Number(fin?.numeroCuotas) || 0;
        if (total > 0 && despues.numCuota > total) {
          throw new ValidationError(`El contrato tiene ${total} cuotas: la cuota #${despues.numCuota} no existe`);
        }
      }

      // En la inscripción, la columna `inscripcion` acompaña a valorPagado.
      const set: string[] = [];
      const vals: any[] = [pagoId];
      for (const campo of campos) { vals.push(despues[campo]); set.push(`"${campo}" = $${vals.length}`); }
      if (tipo === 'INSCRIPCION' && 'valorPagado' in despues) { vals.push(despues.valorPagado); set.push(`"inscripcion" = $${vals.length}`); }
      await client.query(`UPDATE "PAGOS_TITULARES" SET ${set.join(', ')}, "_updatedDate" = NOW() WHERE "_id" = $1`, vals);

      const saldoAntes = pago.contrato
        ? (await client.query(`SELECT "saldo" FROM "FINANCIEROS" WHERE "contrato" = $1 LIMIT 1`, [pago.contrato])).rows[0]?.saldo ?? null
        : null;
      // La factura no mueve dinero: no hace falta recalcular.
      const { saldo: saldoDespues } = tipo === 'FACTURA'
        ? { saldo: saldoAntes }
        : await recalcularSaldosTitular(client, pago.idPeople);

      await client.query(
        `INSERT INTO "PAGOS_AJUSTES" ("_id","pagoId","idPeople","contrato","numCuota","tipo","antes","despues","motivo",
           "saldoAntes","saldoDespues","usuarioEmail","usuarioNombre","usuarioRol")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [ids.audit(), pagoId, pago.idPeople, pago.contrato, cuota, tipo, JSON.stringify(antes), JSON.stringify(despues),
         motivo.trim(), saldoAntes, saldoDespues, session.email, session.nombre, session.role]);

      return { pagoId, contrato: pago.contrato, antes, despues, saldoAntes, saldoDespues };
    });
  },

  /** Últimos ajustes (opcionalmente de un tipo). */
  async historial(session: SessionInfo, tipo: TipoAjuste | null) {
    const params: any[] = [];
    let where = 'TRUE';
    if (tipo) { params.push(tipo); where += ` AND a."tipo" = $1`; }
    const sc = await scopeSql(session, params.length + 1);
    params.push(...sc.params);
    return queryMany(
      `SELECT a.*, TRIM(COALESCE(p."primerNombre",'') || ' ' || COALESCE(p."primerApellido",'')) AS "titular"
         FROM "PAGOS_AJUSTES" a
         LEFT JOIN "PEOPLE" p ON p."_id" = a."idPeople"
        WHERE ${where}${sc.sql}
        ORDER BY a."_createdDate" DESC
        LIMIT 100`,
      params,
    );
  },
};
