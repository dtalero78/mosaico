/**
 * Penalidad de cierre a cuotas (Pago Especial › Última Penalidad en pagos).
 *
 * Ciclo: ACTIVA → COMPLETADA (se pagó la última cuota) | CANCELADA (se retractó).
 *  - Al activar: guarda el saldo inicial y el estado anterior, deja PEOPLE.estado en
 *    "CIERRE A CUOTAS" (los usuarios conservan el acceso) y se deshabilita Registrar Pago.
 *  - Cada pago va por aquí, se aplica a la siguiente cuota (permite adelantar) y queda
 *    marcado. Entra a Verificación y Facturación como cualquier pago.
 *  - Al pagar la última cuota: el contrato pasa a FINALIZADA (titular y beneficiarios
 *    inactivos, sin login), el saldo queda en 0 y el 70% restante se registra como condonado.
 *  - Al cancelar: lo ya pagado pasa a abonos del saldo original, las cuotas pendientes
 *    quedan canceladas, el estado vuelve al anterior y Registrar Pago se habilita.
 * Máximo dos penalidades por contrato (cuentan las canceladas).
 */
import 'server-only';
import { query, queryOne, queryMany, withTransaction } from '@/lib/postgres';
import { PeopleRepository } from '@/repositories/people.repository';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { esAprobado } from '@/lib/estados';
import { asignarPagos } from '@/lib/cuotas-pagos';
import { executeBloqueo } from '@/services/bloqueo-contrato.service';
import { pagosTitularesService, syncFinancieroSaldo } from '@/services/pagos-titulares.service';
import {
  ESTADO_CIERRE_A_CUOTAS, MAX_CUOTAS_PENALIDAD, MAX_PENALIDADES_POR_CONTRATO, PORCENTAJE_PENALIDAD,
  armarPlan, aplicarPagoPlan, pendientePlan, planCompleto, siguienteCuota, type CuotaPenalidad,
} from '@/lib/penalidad';

const toNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const nuevoId = () => `pen_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

export interface PenalidadRow {
  _id: string; idPeople: string; contrato: string | null; numero: number; estado: string;
  saldoInicial: number; porcentaje: number; valorPenalidad: number; condonado: number | null;
  numCuotas: number; cuotas: CuotaPenalidad[]; estadoAnterior: string | null; nota: string | null;
  creadoPor: string | null; completadaEn: string | null; canceladaPor: string | null;
  canceladaEn: string | null; motivoCancelacion: string | null; _createdDate: string;
}

function mapRow(r: any): PenalidadRow {
  return {
    ...r,
    saldoInicial: toNum(r.saldoInicial), porcentaje: toNum(r.porcentaje), valorPenalidad: toNum(r.valorPenalidad),
    condonado: r.condonado == null ? null : toNum(r.condonado),
    cuotas: Array.isArray(r.cuotas) ? r.cuotas : [],
  };
}

async function saldoActual(contrato: string | null | undefined): Promise<number> {
  if (!contrato) return 0;
  const f = await queryOne<any>(`SELECT "saldo" FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`, [contrato]);
  return Math.max(0, toNum(f?.saldo));
}

export const penalidadService = {
  /** Estado de la penalidad del titular: la activa, el historial y si se puede crear otra. */
  async estado(idPeople: string) {
    if (!idPeople) throw new ValidationError('idPeople requerido');
    const titular: any = await PeopleRepository.findById(idPeople);
    if (!titular) throw new NotFoundError('PEOPLE', idPeople);
    const filas = (await queryMany<any>(`SELECT * FROM "PENALIDADES" WHERE "idPeople" = $1 ORDER BY "numero" ASC`, [idPeople])).map(mapRow);
    const activa = filas.find(f => f.estado === 'ACTIVA') || null;
    return {
      contrato: titular.contrato || null,
      estado: titular.estado || null,
      saldo: await saldoActual(titular.contrato),
      porcentaje: PORCENTAJE_PENALIDAD,
      activa,
      historial: filas.filter(f => f.estado !== 'ACTIVA'),
      creadas: filas.length,
      puedeNueva: !activa && filas.length < MAX_PENALIDADES_POR_CONTRATO,
    };
  },

  /** Aprueba el plan: guarda saldo inicial/estado anterior, cambia el estado y crea las cuotas. */
  async activar(
    idPeople: string,
    input: { valorPenalidad: number; numCuotas: number; primeraFecha: string; fechas?: string[]; nota: string },
    actor: string,
  ): Promise<PenalidadRow> {
    const titular: any = await PeopleRepository.findById(idPeople);
    if (!titular) throw new NotFoundError('PEOPLE', idPeople);
    if (titular.tipoUsuario !== 'TITULAR') throw new ValidationError('La penalidad se activa sobre el titular del contrato');
    if (!titular.contrato) throw new ValidationError('El titular no tiene contrato');
    if (!esAprobado(titular.aprobacion)) throw new ValidationError('Sólo un contrato aprobado admite penalidad');
    if (String(titular.estado || '').toUpperCase() === 'FINALIZADA') throw new ValidationError('El contrato ya está finalizado');

    const nota = String(input.nota || '').trim();
    if (!nota) throw new ValidationError('La nota es obligatoria al activar la penalidad');
    const n = Math.floor(Number(input.numCuotas));
    if (!Number.isFinite(n) || n < 1 || n > MAX_CUOTAS_PENALIDAD) throw new ValidationError(`El número de cuotas debe estar entre 1 y ${MAX_CUOTAS_PENALIDAD}`);
    if (!FECHA_RE.test(String(input.primeraFecha || ''))) throw new ValidationError('Fecha de la primera cuota inválida');
    const valor = Math.round(toNum(input.valorPenalidad));
    const saldo = await saldoActual(titular.contrato);
    if (saldo <= 0) throw new ValidationError('El contrato no tiene saldo pendiente');
    if (valor <= 0 || valor > saldo) throw new ValidationError('El valor de la penalidad debe ser mayor a 0 y no superar el saldo');

    const cuotas = armarPlan(valor, n, input.primeraFecha);
    if (Array.isArray(input.fechas) && input.fechas.length === n) {
      if (!input.fechas.every(f => FECHA_RE.test(String(f)))) throw new ValidationError('Hay una fecha de cuota inválida');
      cuotas.forEach((c, i) => { c.fecha = input.fechas![i]; });
    }

    return withTransaction(async (client) => {
      const previas = await client.query(`SELECT "estado","numero" FROM "PENALIDADES" WHERE "idPeople" = $1 FOR UPDATE`, [idPeople]);
      if (previas.rows.some((r: any) => r.estado === 'ACTIVA')) throw new ValidationError('Ya hay una penalidad activa en este contrato');
      if (previas.rows.length >= MAX_PENALIDADES_POR_CONTRATO) {
        throw new ValidationError(`Este contrato ya usó sus ${MAX_PENALIDADES_POR_CONTRATO} penalidades`);
      }
      const numero = previas.rows.length + 1;
      const id = nuevoId();
      const ins = await client.query(
        `INSERT INTO "PENALIDADES" ("_id","idPeople","contrato","numero","estado","saldoInicial","porcentaje","valorPenalidad",
                                    "numCuotas","cuotas","estadoAnterior","nota","creadoPor")
         VALUES ($1,$2,$3,$4,'ACTIVA',$5,$6,$7,$8,$9::jsonb,$10,$11,$12) RETURNING *`,
        [id, idPeople, titular.contrato, numero, saldo, PORCENTAJE_PENALIDAD, valor, n, JSON.stringify(cuotas),
         titular.estado || 'ACTIVA', nota, actor],
      );
      await client.query(`UPDATE "PEOPLE" SET "estado" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`, [idPeople, ESTADO_CIERRE_A_CUOTAS]);
      return mapRow(ins.rows[0]);
    });
  },

  /** Registra un pago de la penalidad: se aplica a las cuotas en orden y las deja marcadas. */
  async registrarPago(planId: string, input: Record<string, any>, actor: string) {
    const fila = await queryOne<any>(`SELECT * FROM "PENALIDADES" WHERE "_id" = $1`, [planId]);
    if (!fila) throw new NotFoundError('PENALIDADES', planId);
    const plan = mapRow(fila);
    if (plan.estado !== 'ACTIVA') throw new ValidationError('Esta penalidad ya no está activa');

    const monto = Math.round(toNum(input.valorPagado));
    if (monto <= 0) throw new ValidationError('El valor del pago debe ser mayor a 0');
    const pendiente = Math.round(pendientePlan(plan.cuotas));
    if (monto > pendiente) throw new ValidationError(`El pago supera lo pendiente de la penalidad ($${pendiente.toLocaleString('es-CL')})`);

    const sig = siguienteCuota(plan.cuotas);
    const { cuotas } = aplicarPagoPlan(plan.cuotas, monto);
    const completa = planCompleto(cuotas);

    // El pago es un pago normal (entra a Verificación y Facturación) marcado como de penalidad.
    const pago = await pagosTitularesService.create({
      ...input,
      idPeople: plan.idPeople,
      numCuota: null,
      valorPagado: monto,
      descuento: 0,
      penalidad: true,
      vlrpenalidad: monto,
      nota: `Penalidad ${plan.numero} · cuota ${sig?.n ?? '—'} de ${plan.numCuotas}` + (input.nota ? ` · ${String(input.nota).trim()}` : ''),
    } as any, actor, { viaPenalidad: true });

    await query(`UPDATE "PAGOS_TITULARES" SET "penalidadPlanId" = $2 WHERE "_id" = $1`, [(pago as any)._id, plan._id]);
    await query(`UPDATE "PENALIDADES" SET "cuotas" = $2::jsonb, "_updatedDate" = NOW() WHERE "_id" = $1`, [plan._id, JSON.stringify(cuotas)]);

    if (completa) await this.completar(plan, cuotas);
    return { pago, completada: completa, cuotas };
  },

  /** Última cuota pagada: se condona el 70%, el saldo queda en 0 y el contrato se finaliza. */
  async completar(plan: PenalidadRow, cuotas: CuotaPenalidad[]) {
    const condonado = Math.max(0, plan.saldoInicial - plan.valorPenalidad);
    await query(
      `UPDATE "PENALIDADES" SET "estado" = 'COMPLETADA', "condonado" = $2, "cuotas" = $3::jsonb,
              "completadaEn" = NOW(), "_updatedDate" = NOW() WHERE "_id" = $1`,
      [plan._id, condonado, JSON.stringify(cuotas)]);
    await query(`UPDATE "FINANCIEROS" SET "saldo" = '0', "_updatedDate" = NOW() WHERE "contrato" = $1`, [plan.contrato]);
    const miembros = await queryMany<any>(
      `SELECT "_id" FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" IN ('TITULAR','BENEFICIARIO')`, [plan.contrato]);
    await executeBloqueo(miembros.map(m => m._id));
    await syncFinancieroSaldo(plan.idPeople).catch(() => { /* best-effort */ });
  },

  /** Cancela el plan: lo pagado pasa a abonos del saldo original y todo vuelve a como estaba. */
  async cancelar(planId: string, motivo: string, actor: string) {
    const m = String(motivo || '').trim();
    if (m.length < 10) throw new ValidationError('El motivo de la cancelación debe tener al menos 10 caracteres');
    const fila = await queryOne<any>(`SELECT * FROM "PENALIDADES" WHERE "_id" = $1`, [planId]);
    if (!fila) throw new NotFoundError('PENALIDADES', planId);
    const plan = mapRow(fila);
    if (plan.estado !== 'ACTIVA') throw new ValidationError('Sólo se puede cancelar una penalidad activa');

    // Primera cuota incompleta del plan ORIGINAL (sin los pagos de penalidad): ahí empiezan los abonos.
    const fin = await queryOne<any>(
      `SELECT "valorCuota","numeroCuotas","pagoInscripcion" FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`, [plan.contrato]);
    const originales = await queryMany<any>(
      `SELECT "_id","numCuota","fechaPago","_createdDate","valorPagado","descuento","inscripcion","validado"
         FROM "PAGOS_TITULARES" WHERE "idPeople" = $1 AND "penalidadPlanId" IS NULL`, [plan.idPeople]);
    let primera = 1;
    if (fin && toNum(fin.valorCuota) > 0) {
      const asig = asignarPagos({
        inscripcion: toNum(fin.pagoInscripcion), valorCuota: toNum(fin.valorCuota),
        numeroCuotas: parseInt(String(fin.numeroCuotas ?? 0), 10) || 0, pagos: originales,
      });
      primera = asig.primeraIncompleta != null && asig.primeraIncompleta >= 1 ? asig.primeraIncompleta
        : originales.reduce((mx: number, x: any) => Math.max(mx, Number(x.numCuota) || 0), 0) + 1;
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE "PAGOS_TITULARES"
            SET "penalidadPlanId" = NULL, "numCuota" = $2, "abono" = true, "penalidad" = false, "vlrpenalidad" = NULL,
                "nota" = COALESCE("nota",'') || ' · Pasó a abono del saldo original al cancelarse la penalidad', "_updatedDate" = NOW()
          WHERE "penalidadPlanId" = $1`, [plan._id, primera]);
      const cuotasCanceladas = plan.cuotas.map(c => (c.pagado >= c.valor - 0.5 ? c : { ...c, cancelada: true }));
      await client.query(
        `UPDATE "PENALIDADES" SET "estado" = 'CANCELADA', "cuotas" = $2::jsonb, "canceladaPor" = $3, "canceladaEn" = NOW(),
                "motivoCancelacion" = $4, "_updatedDate" = NOW() WHERE "_id" = $1`,
        [plan._id, JSON.stringify(cuotasCanceladas), actor, m]);
      await client.query(`UPDATE "PEOPLE" SET "estado" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
        [plan.idPeople, plan.estadoAnterior || 'ACTIVA']);
    });
    await syncFinancieroSaldo(plan.idPeople).catch(() => { /* best-effort */ });
    return this.estado(plan.idPeople);
  },
};
